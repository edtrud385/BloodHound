// Copyright 2023 Specter Ops, Inc.
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

import { shortenNodeLabel } from './legacyView';

describe('shortenNodeLabel', () => {
    it('keeps labels up to 40 characters as they are', () => {
        expect(shortenNodeLabel('DC01.CORP.LOCAL')).toBe('DC01.CORP.LOCAL');
        expect(shortenNodeLabel('DOMAIN CONTROLLERS@EXAMPLE.ORG')).toBe('DOMAIN CONTROLLERS@EXAMPLE.ORG');
    });

    it('never cuts the name before @, only the domain', () => {
        expect(shortenNodeLabel('ADMINISTRATOR@EXAMPLE.ORG', 20)).toBe('ADMINISTRATOR@EXAMPL…');
        expect(shortenNodeLabel('SVC_SQLREPORTING01@CORP.EXAMPLE.COM', 20)).toBe('SVC_SQLREPORTING01@…');
        expect(shortenNodeLabel('SVC_SQLREPORTING_PRODUCTION@SUBSIDIARY.CORP.EXAMPLE.COM')).toBe(
            'SVC_SQLREPORTING_PRODUCTION@SUBSIDIARY.C…'
        );
    });

    it('never cuts a computer name before the first dot', () => {
        expect(shortenNodeLabel('ACME-HQ-WORKSTATION-03.EXAMPLE.ORG', 20)).toBe('ACME-HQ-WORKSTATION-03.…');
        expect(shortenNodeLabel('APP-WEB-SRV01.EXAMPLE.ORG', 20)).toBe('APP-WEB-SRV01.EXAMPL…');
    });

    it('never shortens labels with a SID', () => {
        const sid = 'S-1-5-21-1111111111-2222222222-3333333333-1105';
        expect(shortenNodeLabel(sid)).toBe(sid);
        expect(shortenNodeLabel('EXAMPLE.ORG-S-1-5-32-544')).toBe('EXAMPLE.ORG-S-1-5-32-544');
    });

    it('keeps labels without a domain whole', () => {
        expect(shortenNodeLabel('ENTERPRISE KEY ADMINS AND OPERATORS')).toBe('ENTERPRISE KEY ADMINS AND OPERATORS');
    });
});
