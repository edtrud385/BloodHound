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

import { fillPickerQuery, toCypherString } from './QueryPicker';

describe('QueryPicker helpers', () => {
    it('quotes picked names as Cypher strings', () => {
        expect(toCypherString('CORP.LOCAL')).toBe("'CORP.LOCAL'");
        expect(toCypherString("O'BRIEN\\ADMINS")).toBe("'O\\'BRIEN\\\\ADMINS'");
    });

    it('replaces every $result in the picker query', () => {
        const picker = {
            title: 'Select a Domain...',
            options: 'MATCH (n:Domain) RETURN n',
            query: 'MATCH p=(c:Computer)-[:HasSession]->(u)\nWHERE c.domain = $result AND u.domain <> $result\nRETURN p',
        };
        expect(fillPickerQuery(picker, 'CORP.LOCAL')).toBe(
            "MATCH p=(c:Computer)-[:HasSession]->(u)\nWHERE c.domain = 'CORP.LOCAL' AND u.domain <> 'CORP.LOCAL'\nRETURN p"
        );
    });
});
