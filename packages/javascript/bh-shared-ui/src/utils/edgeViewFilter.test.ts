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
    applyEdgeFilterToQuery,
    applyEdgeFilterView,
    deleteEdgeFilterView,
    getEdgeFilterState,
    getQueryHiddenEdgeKinds,
    recalculateWithEdgeFilter,
    resetEdgeFilter,
    saveEdgeFilterView,
    setEdgeKindsHidden,
    setHideOrphans,
} from './edgeViewFilter';

describe('applyEdgeFilterToQuery', () => {
    it('removes hidden kinds from multi-type lists', () => {
        expect(
            applyEdgeFilterToQuery('MATCH p=shortestPath((n)-[:MemberOf|HasSession|AdminTo*1..]->(m)) RETURN p', [
                'HasSession',
            ])
        ).toBe('MATCH p=shortestPath((n)-[:MemberOf|AdminTo*1..]->(m)) RETURN p');
    });

    it('keeps relationship variables', () => {
        expect(applyEdgeFilterToQuery('MATCH p=(n)-[r:CanRDP|AdminTo]->(c) RETURN p', ['AdminTo'])).toBe(
            'MATCH p=(n)-[r:CanRDP]->(c) RETURN p'
        );
    });

    it('leaves single-type patterns and fully hidden lists alone', () => {
        const query = 'MATCH p=(c)-[:HasSession]->(u)-[:MemberOf|AdminTo]->(g) RETURN p';
        expect(applyEdgeFilterToQuery(query, ['HasSession', 'MemberOf', 'AdminTo'])).toBe(query);
    });

    it('does nothing without hidden kinds', () => {
        const query = 'MATCH p=(n)-[:MemberOf|AdminTo*1..]->(m) RETURN p';
        expect(applyEdgeFilterToQuery(query, [])).toBe(query);
    });
});

describe('edge filter views', () => {
    beforeEach(() => {
        getEdgeFilterState().views.forEach((v) => deleteEdgeFilterView(v.name));
        resetEdgeFilter();
    });

    it('saves and re-applies a named view', () => {
        setEdgeKindsHidden(['HasSession', 'CanRDP'], true);
        setHideOrphans(false);
        saveEdgeFilterView('No sessions');
        expect(getEdgeFilterState().viewName).toBe('No sessions');

        resetEdgeFilter();
        expect(getEdgeFilterState().hiddenKinds).toEqual([]);
        expect(getEdgeFilterState().viewName).toBeUndefined();

        applyEdgeFilterView('No sessions');
        expect(getEdgeFilterState().hiddenKinds).toEqual(['CanRDP', 'HasSession']);
        expect(getEdgeFilterState().hideOrphans).toBe(false);
        expect(JSON.parse(localStorage.getItem('bh-edge-view-filter')!).views).toHaveLength(1);
    });
});

describe('recalculate', () => {
    beforeEach(() => resetEdgeFilter());

    it('strips hidden kinds from the recalculated query only', () => {
        setEdgeKindsHidden(['HasSession'], true);
        recalculateWithEdgeFilter('encoded-query-1');
        const filter = getEdgeFilterState();
        expect(getQueryHiddenEdgeKinds(filter, 'encoded-query-1')).toEqual(['HasSession']);
        expect(getQueryHiddenEdgeKinds(filter, 'encoded-query-2')).toEqual([]);
    });

    it('is cleared by Show all', () => {
        setEdgeKindsHidden(['HasSession'], true);
        recalculateWithEdgeFilter('encoded-query-1');
        resetEdgeFilter();
        expect(getQueryHiddenEdgeKinds(getEdgeFilterState(), 'encoded-query-1')).toEqual([]);
    });
});
