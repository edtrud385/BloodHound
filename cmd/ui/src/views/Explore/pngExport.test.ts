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

import { cleanPrefix, getNextDownloadNumber, nextNumber, numberedName, setNextDownloadNumber } from './pngExport';

describe('PNG export naming', () => {
    it('numbers one past the highest existing file for the prefix', () => {
        const files = ['bloodhound-001.png', 'bloodhound-007.png', 'other-020.png', 'bloodhound.png', 'notes.txt'];
        expect(nextNumber(files, 'bloodhound')).toBe(8);
        expect(nextNumber(files, 'other')).toBe(21);
        expect(nextNumber([], 'bloodhound')).toBe(1);
    });

    it('treats the prefix literally', () => {
        expect(nextNumber(['a.b-002.png', 'axb-009.png'], 'a.b')).toBe(3);
    });

    it('pads numbers to three digits', () => {
        expect(numberedName('DA paths', 4)).toBe('DA paths-004.png');
        expect(numberedName('x', 1234)).toBe('x-1234.png');
    });

    it('cleans names the file system would reject', () => {
        expect(cleanPrefix('paths/to:DA.png')).toBe('paths-to-DA');
        expect(cleanPrefix('   ')).toBe('bloodhound');
    });
});

describe('download numbering (no folder API)', () => {
    beforeEach(() => localStorage.clear());

    it('keeps a separate next number per file name', () => {
        expect(getNextDownloadNumber('bloodhound')).toBe(1);
        setNextDownloadNumber('bloodhound', 12);
        expect(getNextDownloadNumber('bloodhound')).toBe(12);
        expect(getNextDownloadNumber('DA-paths')).toBe(1);
    });

    it('never goes below 1', () => {
        setNextDownloadNumber('x', -3);
        expect(getNextDownloadNumber('x')).toBe(1);
    });
});
