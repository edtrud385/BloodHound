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

import { GraphNode } from 'js-client-library';
import { getReachableTierZeroTargets, reachableTierZeroQuery } from './ReachableTierZeroSection';

const node = (objectId: string, label: string, isTierZero: boolean) =>
    ({ objectId, label, isTierZero, kind: 'Group', kinds: [], lastSeen: '', isOwnedObject: false }) as GraphNode;

describe('Reachable Tier Zero Targets', () => {
    it('builds a shortest-path query from the object to Tier Zero over traversable edges', () => {
        const query = reachableTierZeroQuery("S-1-5-21-1111111111-2222222222-3333333333-512");
        expect(query).toContain("m.objectid = 'S-1-5-21-1111111111-2222222222-3333333333-512'");
        expect(query).toContain('MATCH (n:Tag_Tier_Zero) WHERE n <> m');
        expect(query).toMatch(/shortestPath\(\(m\)-\[:[A-Za-z0-9|]*MemberOf[A-Za-z0-9|]*\*1\.\.\]->\(n\)\)/);
    });

    it('escapes quotes in the object id', () => {
        expect(reachableTierZeroQuery("it's")).toContain("m.objectid = 'it\\'s'");
    });

    it('counts Tier Zero objects in the result except the start, sorted by name', () => {
        const nodes = {
            '1': node('START', 'DOMAIN ADMINS@EXAMPLE.ORG', true),
            '2': node('B', 'ZED@EXAMPLE.ORG', true),
            '3': node('C', 'WORKSTATION01.EXAMPLE.ORG', false),
            '4': node('D', 'ADMINISTRATOR@EXAMPLE.ORG', true),
        };
        expect(getReachableTierZeroTargets(nodes, 'START').map((n) => n.objectId)).toEqual(['D', 'B']);
    });
});
