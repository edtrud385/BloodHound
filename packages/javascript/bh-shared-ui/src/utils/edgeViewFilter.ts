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
 * Legacy-style edge filter for the Explore graph, kept in this browser.
 *
 *  - Display filter: edge kinds in `hiddenKinds` are hidden in the drawn graph (and, with `hideOrphans`,
 *    nodes left without a visible edge).
 *  - Query filter: with `applyToQueries`, those kinds are also removed from the edge-type lists of every
 *    Cypher query before it runs, so paths around them can show up (Legacy's "Apply filter to every query").
 *  - Views: named snapshots of the above that can be re-applied.
 */

import { useSyncExternalStore } from 'react';

export type EdgeFilterSettings = {
    hiddenKinds: string[];
    hideOrphans: boolean;
    applyToQueries: boolean;
};

export type EdgeFilterView = EdgeFilterSettings & { name: string };

export type EdgeFilterState = EdgeFilterSettings & {
    /** Name of the view the settings came from; cleared as soon as they are changed. */
    viewName?: string;
    views: EdgeFilterView[];
    /**
     * One-off "Recalculate": the hidden kinds to strip from one Cypher query (the encoded cypherSearch it
     * was pressed for), even with applyToQueries off. A different query runs unfiltered again.
     */
    recalculated?: { query: string; hiddenKinds: string[] };
};

const STORAGE_KEY = 'bh-edge-view-filter';

const DEFAULT_STATE: EdgeFilterState = { hiddenKinds: [], hideOrphans: true, applyToQueries: false, views: [] };

const load = (): EdgeFilterState => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_STATE;
        const parsed = JSON.parse(raw);
        return {
            hiddenKinds: Array.isArray(parsed.hiddenKinds)
                ? parsed.hiddenKinds.filter((k: unknown) => typeof k === 'string')
                : [],
            hideOrphans: parsed.hideOrphans !== false,
            applyToQueries: parsed.applyToQueries === true,
            viewName: typeof parsed.viewName === 'string' ? parsed.viewName : undefined,
            views: Array.isArray(parsed.views) ? parsed.views.filter((v: any) => v && typeof v.name === 'string') : [],
            recalculated:
                parsed.recalculated &&
                typeof parsed.recalculated.query === 'string' &&
                Array.isArray(parsed.recalculated.hiddenKinds)
                    ? { query: parsed.recalculated.query, hiddenKinds: parsed.recalculated.hiddenKinds }
                    : undefined,
        };
    } catch {
        return DEFAULT_STATE;
    }
};

let state: EdgeFilterState = load();
const listeners = new Set<() => void>();

const commit = (next: EdgeFilterState) => {
    state = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // storage unavailable (private window): the filter just isn't remembered
    }
    listeners.forEach((listener) => listener());
};

export const getEdgeFilterState = (): EdgeFilterState => state;

export const subscribeEdgeFilter = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** The edge filter, re-rendering the caller when it changes. */
export const useEdgeFilter = (): EdgeFilterState => useSyncExternalStore(subscribeEdgeFilter, getEdgeFilterState);

const update = (changes: Partial<EdgeFilterSettings>) => commit({ ...state, ...changes, viewName: undefined });

export const setHiddenEdgeKinds = (kinds: string[]) => update({ hiddenKinds: [...new Set(kinds)].sort() });

export const setEdgeKindsHidden = (kinds: string[], hidden: boolean) => {
    const next = new Set(state.hiddenKinds);
    kinds.forEach((kind) => (hidden ? next.add(kind) : next.delete(kind)));
    setHiddenEdgeKinds([...next]);
};

export const setHideOrphans = (hideOrphans: boolean) => update({ hideOrphans });

export const setApplyEdgeFilterToQueries = (applyToQueries: boolean) => update({ applyToQueries });

/** Save the current settings as a view (replacing a view of the same name) and mark it current. */
export const saveEdgeFilterView = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const view: EdgeFilterView = {
        name: trimmed,
        hiddenKinds: state.hiddenKinds,
        hideOrphans: state.hideOrphans,
        applyToQueries: state.applyToQueries,
    };
    const views = [...state.views.filter((v) => v.name !== trimmed), view].sort((a, b) => a.name.localeCompare(b.name));
    commit({ ...state, views, viewName: trimmed });
};

export const applyEdgeFilterView = (name: string) => {
    const view = state.views.find((v) => v.name === name);
    if (!view) return;
    commit({
        ...state,
        hiddenKinds: view.hiddenKinds,
        hideOrphans: view.hideOrphans,
        applyToQueries: view.applyToQueries,
        viewName: view.name,
    });
};

export const deleteEdgeFilterView = (name: string) =>
    commit({
        ...state,
        views: state.views.filter((v) => v.name !== name),
        viewName: state.viewName === name ? undefined : state.viewName,
    });

/** Re-run `query` (the encoded cypherSearch) once without the currently hidden edge kinds. */
export const recalculateWithEdgeFilter = (query: string) =>
    commit({ ...state, recalculated: { query, hiddenKinds: state.hiddenKinds } });

/** Edge kinds to strip from the Cypher query `query` (encoded cypherSearch): always, or after Recalculate. */
export const getQueryHiddenEdgeKinds = (filter: EdgeFilterState, query?: string | null): string[] => {
    if (filter.applyToQueries) return filter.hiddenKinds;
    if (query && filter.recalculated?.query === query) return filter.recalculated.hiddenKinds;
    return [];
};

/** Show every edge again (keeps saved views). */
export const resetEdgeFilter = () =>
    commit({ ...state, hiddenKinds: [], applyToQueries: false, viewName: undefined, recalculated: undefined });

/**
 * Remove `hiddenKinds` from every multi-type relationship list in a Cypher query, e.g.
 * `-[:MemberOf|HasSession|AdminTo*1..]->` without HasSession becomes `-[:MemberOf|AdminTo*1..]->`.
 * Single-type patterns such as `-[:HasSession]->` are what the query is about and stay as written,
 * and a list is left alone if every one of its types is hidden (removing them all would break it).
 */
export const applyEdgeFilterToQuery = (query: string, hiddenKinds: string[]): string => {
    if (!hiddenKinds.length) return query;
    const hidden = new Set(hiddenKinds);
    return query.replace(
        /\[(\s*[A-Za-z_][A-Za-z0-9_]*)?\s*:\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*\|\s*:?\s*[A-Za-z_][A-Za-z0-9_]*)+)/g,
        (match, variable: string | undefined, types: string) => {
            const kinds = types.split('|').map((t) => t.replace(':', '').trim());
            const kept = kinds.filter((kind) => !hidden.has(kind));
            if (kept.length === kinds.length || kept.length === 0) return match;
            return `[${variable ?? ''}:${kept.join('|')}`;
        }
    );
};
