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

import {
    applyNodeExclusionsToQuery,
    clearNodeExclusions,
    excludeNode,
    getNodeExclusionState,
    includeNode,
    isNodeExcluded,
} from './nodeExclusion';

const ID = 'S-1-5-21-1-2-3-512';
const NONE_P = `NONE(excluded_node IN nodes(p) WHERE excluded_node.objectid IN ['${ID}'])`;

describe('applyNodeExclusionsToQuery', () => {
    it('leaves the query alone without exclusions', () => {
        const q = 'MATCH p=(n)-[:MemberOf]->(m) RETURN p';
        expect(applyNodeExclusionsToQuery(q, [])).toBe(q);
    });

    it('filters a shortest path as a whole', () => {
        expect(
            applyNodeExclusionsToQuery('MATCH p=shortestPath((u:User)-[:MemberOf|AdminTo*1..]->(d:Domain)) RETURN p', [
                ID,
            ])
        ).toBe(`MATCH p=shortestPath((u:User)-[:MemberOf|AdminTo*1..]->(d:Domain)) WHERE ${NONE_P} RETURN p`);
    });

    it('ANDs the filter to an existing WHERE, keeping its precedence', () => {
        expect(
            applyNodeExclusionsToQuery(
                "MATCH p=(n:User)-[:MemberOf*1..]->(g:Group)\nWHERE g.name = 'A' OR g.name = 'B'\nRETURN p",
                [ID]
            )
        ).toBe(
            `MATCH p=(n:User)-[:MemberOf*1..]->(g:Group)\nWHERE (g.name = 'A' OR g.name = 'B') AND ${NONE_P}\nRETURN p`
        );
    });

    it('filters each named node of a pattern without a path name', () => {
        expect(
            applyNodeExclusionsToQuery("MATCH (n)-[r:MemberOf]->(g:Group {name:'DOMAIN ADMINS'}) RETURN n, r, g", [ID])
        ).toBe(
            `MATCH (n)-[r:MemberOf]->(g:Group {name:'DOMAIN ADMINS'}) WHERE NOT n.objectid IN ['${ID}'] AND NOT g.objectid IN ['${ID}'] RETURN n, r, g`
        );
    });

    it('handles every MATCH clause, including OPTIONAL MATCH and lowercase keywords', () => {
        const out = applyNodeExclusionsToQuery(
            'match p=(a)-[:MemberOf]->(b) optional match p2=(b)-[:AdminTo]->(c) return p, p2',
            [ID]
        );
        expect(out).toContain(`match p=(a)-[:MemberOf]->(b) WHERE ${NONE_P} optional match`);
        expect(out).toContain('optional match p2=(b)-[:AdminTo]->(c) WHERE NONE(excluded_node IN nodes(p2)');
    });

    it('does not mistake keywords or parentheses inside strings for clauses or nodes', () => {
        const q = "MATCH p=(n {description:'run WHERE (x) RETURN'})-[:MemberOf]->(m) RETURN p";
        expect(applyNodeExclusionsToQuery(q, [ID])).toBe(
            `MATCH p=(n {description:'run WHERE (x) RETURN'})-[:MemberOf]->(m) WHERE ${NONE_P} RETURN p`
        );
    });

    it('ignores WHERE inside list comprehensions and patterns with only anonymous nodes', () => {
        expect(applyNodeExclusionsToQuery('MATCH (:User)-[:MemberOf]->(:Group) RETURN count(*)', [ID])).toBe(
            'MATCH (:User)-[:MemberOf]->(:Group) RETURN count(*)'
        );
        expect(
            applyNodeExclusionsToQuery(
                'MATCH p=(n)-[*1..]->(m) WITH p, [x IN nodes(p) WHERE x.enabled] AS e RETURN p',
                [ID]
            )
        ).toBe(`MATCH p=(n)-[*1..]->(m) WHERE ${NONE_P} WITH p, [x IN nodes(p) WHERE x.enabled] AS e RETURN p`);
    });

    it('lists several ids and escapes quotes', () => {
        expect(applyNodeExclusionsToQuery('MATCH p=(a)-->(b) RETURN p', ['A', "O'B"])).toBe(
            "MATCH p=(a)-->(b) WHERE NONE(excluded_node IN nodes(p) WHERE excluded_node.objectid IN ['A', 'O\\'B']) RETURN p"
        );
    });
});

describe('node exclusion list', () => {
    beforeEach(() => clearNodeExclusions());

    it('adds each object once and removes it again', () => {
        excludeNode({ objectid: ID, name: 'DOMAIN ADMINS@CONTOSO.LOCAL', kind: 'Group' });
        excludeNode({ objectid: ID, name: 'DOMAIN ADMINS@CONTOSO.LOCAL', kind: 'Group' });
        expect(getNodeExclusionState().excluded).toHaveLength(1);
        expect(isNodeExcluded(ID)).toBe(true);
        includeNode(ID);
        expect(isNodeExcluded(ID)).toBe(false);
    });
});
