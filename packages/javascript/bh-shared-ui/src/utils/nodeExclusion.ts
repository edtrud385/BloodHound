// Copyright 2026 Specter Ops, Inc.
//
// Licensed under the Apache License, Version 2.0
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/*
 * Objects excluded from Explore queries (right-click > Exclude from query), kept in this browser.
 *
 *  - Query: while the list is not empty, every Cypher query is run with the excluded objects filtered out
 *    of its MATCH clauses (by objectid), so shortest paths are found around them.
 *  - Display: excluded objects are also hidden in the drawn graph, which covers searches that do not run
 *    the Cypher query (node search, pathfinding) and patterns the rewrite cannot reach.
 */

import { useSyncExternalStore } from 'react';

export type ExcludedNode = { objectid: string; name: string; kind?: string };

export type NodeExclusionState = { excluded: ExcludedNode[] };

const STORAGE_KEY = 'bh-node-exclusions';

const load = (): NodeExclusionState => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const excluded = Array.isArray(parsed?.excluded)
            ? parsed.excluded.filter((n: any) => n && typeof n.objectid === 'string' && n.objectid)
            : [];
        return { excluded };
    } catch {
        return { excluded: [] };
    }
};

let state: NodeExclusionState = load();
const listeners = new Set<() => void>();

const commit = (next: NodeExclusionState) => {
    state = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // storage unavailable (private window): the list just isn't remembered
    }
    listeners.forEach((listener) => listener());
};

export const getNodeExclusionState = (): NodeExclusionState => state;

export const subscribeNodeExclusions = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** The excluded objects, re-rendering the caller when the list changes. */
export const useNodeExclusions = (): NodeExclusionState =>
    useSyncExternalStore(subscribeNodeExclusions, getNodeExclusionState);

export const excludeNode = (node: ExcludedNode) => {
    if (!node.objectid || state.excluded.some((n) => n.objectid === node.objectid)) return;
    commit({ excluded: [...state.excluded, node] });
};

export const includeNode = (objectid: string) =>
    commit({ excluded: state.excluded.filter((n) => n.objectid !== objectid) });

export const clearNodeExclusions = () => commit({ excluded: [] });

export const isNodeExcluded = (objectid?: string | null): boolean =>
    !!objectid && state.excluded.some((n) => n.objectid === objectid);

/* ------------------------------------------------------------------------------------------------ */
/* Query rewrite                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

const CLAUSE_KEYWORD =
    /(OPTIONAL\s+MATCH|MATCH|WHERE|WITH|RETURN|UNWIND|CALL|ORDER\s+BY|SKIP|LIMIT|UNION|CREATE|MERGE|DETACH|DELETE|SET|REMOVE|FOREACH|YIELD)(?![A-Za-z0-9_])/iy;

type Clause = { keyword: string; start: number; bodyStart: number; end: number };

/**
 * Walk `text` and call `visit(index)` for every character at bracket depth 0 that is outside strings,
 * backtick names and comments. `visit` may return a number of characters to skip.
 */
const scanTopLevel = (text: string, visit: (index: number) => number | void) => {
    let depth = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === "'" || ch === '"' || ch === '`') {
            i++;
            while (i < text.length && text[i] !== ch) i += text[i] === '\\' && ch !== '`' ? 2 : 1;
            i++;
            continue;
        }
        if (ch === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            const close = text.indexOf('*/', i + 2);
            i = close === -1 ? text.length : close + 2;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (depth === 0) {
            const skip = visit(i);
            if (skip) {
                i += skip;
                continue;
            }
        }
        i++;
    }
};

const splitClauses = (query: string): Clause[] => {
    const clauses: Clause[] = [];
    scanTopLevel(query, (i) => {
        if (i > 0 && /[A-Za-z0-9_$]/.test(query[i - 1])) return;
        CLAUSE_KEYWORD.lastIndex = i;
        const match = CLAUSE_KEYWORD.exec(query);
        if (!match) return;
        if (clauses.length) clauses[clauses.length - 1].end = i;
        clauses.push({
            keyword: match[1].toUpperCase().replace(/\s+/g, ' '),
            start: i,
            bodyStart: i + match[0].length,
            end: query.length,
        });
        return match[0].length;
    });
    return clauses;
};

/** Split a MATCH pattern on its top-level commas. */
const splitPatternParts = (pattern: string): string[] => {
    const parts: string[] = [];
    let last = 0;
    scanTopLevel(pattern, (i) => {
        if (pattern[i] === ',') {
            parts.push(pattern.slice(last, i));
            last = i + 1;
        }
    });
    parts.push(pattern.slice(last));
    return parts;
};

const NODE_VARIABLE = /(?<![A-Za-z0-9_$])\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=[:{)]|\s)/g;
const PATH_VARIABLE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Blank out string literals and backtick names (same length), so the variable patterns can't match inside them. */
const maskStrings = (text: string) =>
    text.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`[^`]*`/g, (m) => ' '.repeat(m.length));

/** The filter for one MATCH pattern: whole named paths, or the named nodes of unnamed patterns. */
const exclusionCondition = (pattern: string, idList: string): string | null => {
    const conditions: string[] = [];
    const seen = new Set<string>();
    for (const part of splitPatternParts(maskStrings(pattern))) {
        const path = PATH_VARIABLE.exec(part);
        if (path) {
            conditions.push(`NONE(excluded_node IN nodes(${path[1]}) WHERE excluded_node.objectid IN ${idList})`);
            continue;
        }
        for (const match of part.matchAll(NODE_VARIABLE)) {
            const variable = match[1];
            if (seen.has(variable)) continue;
            seen.add(variable);
            conditions.push(`NOT ${variable}.objectid IN ${idList}`);
        }
    }
    return conditions.length ? conditions.join(' AND ') : null;
};

const cypherString = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Filter the objects with `objectIds` out of every MATCH clause of a Cypher query, e.g.
 * `MATCH p=shortestPath((u)-[*1..]->(d)) RETURN p` becomes
 * `MATCH p=shortestPath((u)-[*1..]->(d)) WHERE NONE(excluded_node IN nodes(p) WHERE excluded_node.objectid IN ['S-1-5-...']) RETURN p`.
 * Named paths are filtered as a whole (so shortest paths go around the excluded objects); patterns
 * without a path name filter each named node. An existing WHERE is kept and the filter is ANDed to it.
 */
export const applyNodeExclusionsToQuery = (query: string, objectIds: string[]): string => {
    if (!objectIds.length) return query;
    const idList = `[${objectIds.map(cypherString).join(', ')}]`;
    const clauses = splitClauses(query);
    const edits: { at: number; remove: number; insert: string }[] = [];

    clauses.forEach((clause, index) => {
        if (clause.keyword !== 'MATCH' && clause.keyword !== 'OPTIONAL MATCH') return;
        const condition = exclusionCondition(query.slice(clause.bodyStart, clause.end), idList);
        if (!condition) return;
        const where = clauses[index + 1]?.keyword === 'WHERE' ? clauses[index + 1] : null;
        if (where) {
            const expression = query.slice(where.bodyStart, where.end);
            const trimmed = expression.trimEnd();
            edits.push({
                at: where.bodyStart,
                remove: trimmed.length,
                insert: ` (${trimmed.trim()}) AND ${condition}`,
            });
        } else {
            const body = query.slice(clause.bodyStart, clause.end);
            const at = clause.bodyStart + body.trimEnd().length;
            edits.push({ at, remove: 0, insert: ` WHERE ${condition}` });
        }
    });

    return edits
        .sort((a, b) => b.at - a.at)
        .reduce((text, edit) => text.slice(0, edit.at) + edit.insert + text.slice(edit.at + edit.remove), query);
};
