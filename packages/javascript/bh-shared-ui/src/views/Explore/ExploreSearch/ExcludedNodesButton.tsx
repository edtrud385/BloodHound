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

import { faEyeSlash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconButton, Popover } from '@mui/material';
import { Button } from 'doodle-ui';
import { FC, useState } from 'react';
import { clearNodeExclusions, includeNode, useNodeExclusions } from '../../../utils/nodeExclusion';

/**
 * "Excluded (n)" next to Tag / Save on the Cypher tab: the objects excluded with right-click > Exclude from
 * query, each with an x to bring it back. While the list has entries every Cypher query runs without them.
 */
const ExcludedNodesButton: FC<{
    /** Icon-and-count version for the search tab bar, shown only while something is excluded. */
    compact?: boolean;
}> = ({ compact = false }) => {
    const { excluded } = useNodeExclusions();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const count = excluded.length;
    if (compact && !count) return null;

    return (
        <>
            {compact ? (
                <button
                    type='button'
                    className='flex items-center gap-1 px-2 h-8 rounded-sm text-sm font-bold text-primary dark:text-secondary-variant-2 hover:bg-neutral-light-3 dark:hover:bg-neutral-dark-3'
                    onClick={(event) => setAnchor(event.currentTarget)}
                    aria-label={`${count} objects excluded from queries`}
                    title={`${count} objects excluded from every query`}
                    data-testid='explore_search-container_header_excluded'>
                    <FontAwesomeIcon icon={faEyeSlash} />
                    {count}
                </button>
            ) : (
                <Button
                    variant={count ? 'primary' : 'secondary'}
                    size='small'
                    onClick={(event) => setAnchor(event.currentTarget)}
                    aria-label={count ? `${count} objects excluded from queries` : 'Objects excluded from queries'}
                    title={count ? `${count} objects excluded from every query` : 'Objects excluded from queries'}
                    data-testid='explore_cypher_excluded-button'>
                    <p className='text-base'>{count ? `Excluded (${count})` : 'Excluded'}</p>
                </Button>
            )}
            <Popover
                open={!!anchor}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                anchorOrigin={
                    compact ? { vertical: 'bottom', horizontal: 'left' } : { vertical: 'top', horizontal: 'left' }
                }
                transformOrigin={
                    compact ? { vertical: 'top', horizontal: 'left' } : { vertical: 'bottom', horizontal: 'left' }
                }
                PaperProps={{ 'data-testid': 'explore_cypher_excluded-panel' } as any}>
                <div className='p-3 w-[360px] text-sm'>
                    <div className='flex items-center justify-between mb-1'>
                        <span className='font-bold'>Excluded from queries</span>
                        {count > 0 && (
                            <button
                                type='button'
                                className='text-primary text-xs font-bold uppercase'
                                onClick={() => clearNodeExclusions()}
                                data-testid='explore_cypher_excluded-clear'>
                                Clear all
                            </button>
                        )}
                    </div>
                    {count === 0 ? (
                        <p className='text-neutral-dark-5 dark:text-neutral-light-5'>
                            Right-click an object on the graph and choose <b>Exclude from query</b>. Every Cypher query
                            then runs without it, so shortest paths go around it.
                        </p>
                    ) : (
                        <>
                            <p className='text-neutral-dark-5 dark:text-neutral-light-5 mb-2'>
                                Every Cypher query runs without these objects, and they are hidden in the graph.
                            </p>
                            <ul className='max-h-[300px] overflow-y-auto'>
                                {excluded.map((node) => (
                                    <li
                                        key={node.objectid}
                                        className='flex items-center justify-between gap-2 py-0.5'
                                        data-testid='explore_cypher_excluded-item'>
                                        <span className='truncate' title={`${node.name} (${node.objectid})`}>
                                            {node.name}
                                            {node.kind && (
                                                <span className='ml-1 text-xs text-neutral-dark-5 dark:text-neutral-light-5'>
                                                    {node.kind}
                                                </span>
                                            )}
                                        </span>
                                        <IconButton
                                            size='small'
                                            aria-label={`Include ${node.name} again`}
                                            onClick={() => includeNode(node.objectid)}>
                                            <FontAwesomeIcon icon={faXmark} size='xs' />
                                        </IconButton>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            </Popover>
        </>
    );
};

export default ExcludedNodesButton;
