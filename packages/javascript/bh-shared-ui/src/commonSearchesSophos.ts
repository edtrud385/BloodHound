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

// The "Sophos Queries" pre-built set. It is intentionally empty in the repository: the real review
// queries are generated locally by ce-review-queries/build.py (kept outside this repo) and never
// committed. After generating them, run
//     git update-index --skip-worktree packages/javascript/bh-shared-ui/src/commonSearchesSophos.ts
// so git ignores the local copy.

import { CommonSearchType } from './types';

export const CommonSearches: CommonSearchType[] = [];
