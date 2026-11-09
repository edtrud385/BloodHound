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

import { faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    BaseExploreLayoutOptions,
    ContextMenuPrivilegeZonesEnabled,
    DEFAULT_PINNED_COLUMN_KEYS,
    ExploreTable,
    FeatureFlag,
    GraphControls,
    GraphItemInformationPanel,
    GraphProgress,
    GraphViewErrorAlert,
    ManageColumnsComboBoxOption,
    NodeClickInfo,
    WebGLDisabledAlert,
    baseGraphLayouts,
    defaultGraphLayout,
    glyphUtils,
    isNodeResponse,
    isWebGLEnabled,
    makeStoreMapFromColumnOptions,
    useAppName,
    useAutomaticGraphActions,
    useCustomNodeKinds,
    useExploreParams,
    useExploreSelectedItem,
    useExploreTableAutoDisplay,
    useFeatureFlag,
    useGraphHasData,
    useKeybindings,
    useTagGlyphs,
    useTheme,
    useToggle,
} from 'bh-shared-ui';
import { IconButton, Tooltip } from 'doodle-ui';
import { MultiDirectedGraph } from 'graphology';
import { Attributes } from 'graphology-types';
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { SigmaNodeEventPayload } from 'sigma/sigma';
import { NoDataFileUploadDialogWithLinks } from 'src/components/NoDataFileUploadDialogWithLinks';
import SigmaChart from 'src/components/SigmaChart';
import {
    setExploreLayout,
    setIsExploreLayoutSelected,
    setIsExploreTableSelected,
    setPinnedExploreTableColumns,
    setSelectedExploreTableColumns,
} from 'src/ducks/global/actions';
import { useSigmaExploreGraph } from 'src/hooks/useSigmaExploreGraph';
import { expandGroup, findGroupContaining, isGroupEdge, isGroupItem, isGroupNode } from 'src/rendering/legacyView';
import { useAppDispatch, useAppSelector } from 'src/store';
import { initGraph } from 'src/views/Explore/utils';
import ContextMenu from './ContextMenu/ContextMenu';
import ExploreSearch from './ExploreSearch/ExploreSearch';
import { transformIconDictionary } from './svgIcons';

const GraphView: FC = () => {
    /* Hooks */
    const theme = useTheme();
    const dispatch = useAppDispatch();
    const appName = useAppName();
    const title = (
        <Helmet>
            <title>Explore | {appName}</title>
        </Helmet>
    );
    // For Screen Readers
    const hiddenHeading = <h1 className='sr-only'>Explore</h1>;

    const { selectedItem, setSelectedItem, selectedItemQuery, previousSelectedItem, clearSelectedItem } =
        useExploreSelectedItem();
    const { searchType, setExploreParams, exploreSearchTab } = useExploreParams();

    const graphQuery = useSigmaExploreGraph();

    // Automatically select the first node when performing a node search, or clear selection for pathfinding searches
    useAutomaticGraphActions(graphQuery.data);

    const graphHasDataQuery = useGraphHasData();

    const [graphologyGraph, setGraphologyGraph] = useState<MultiDirectedGraph<Attributes, Attributes, Attributes>>();
    const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);

    const sigmaChartRef = useRef<any>(null);

    const darkMode = useAppSelector((state) => state.global.view.darkMode);
    const exploreLayout = useAppSelector((state) => state.global.view.exploreLayout);
    const selectedColumns = useAppSelector((state) => state.global.view.selectedExploreTableColumns);
    const pinnedColumns = useAppSelector((state) => state.global.view.pinnedExploreTableColumns);
    const isExploreTableSelected = useAppSelector((state) => state.global.view.isExploreTableSelected);
    const isExploreLayoutSelected = useAppSelector((state) => state.global.view.isExploreLayoutSelected);

    const customIconsQuery = useCustomNodeKinds({ select: transformIconDictionary });

    const { data: pzFeatureFlag } = useFeatureFlag('tier_management_engine');
    const tagGlyphs = useTagGlyphs(glyphUtils, darkMode);

    const autoDisplayTableEnabled = !isExploreLayoutSelected && !isExploreTableSelected;
    const [autoDisplayTable, setAutoDisplayTable] = useExploreTableAutoDisplay(autoDisplayTableEnabled);
    // TODO: incorporate into larger hook with auto display table logic
    const displayTable = searchType === 'cypher' && (isExploreTableSelected || autoDisplayTable);

    const [showNodeLabels, toggleShowNodeLabels] = useToggle(true);
    const [showEdgeLabels, toggleShowEdgeLabels] = useToggle(true);
    // Legacy view: fold leaf nodes into group nodes (on by default, like Legacy's node collapse)
    const [collapseLeafNodes, toggleCollapseLeafNodes] = useToggle(true);

    const isWebGLEnabledMemo = useMemo(() => isWebGLEnabled(), []);

    const graphOptions = useMemo(() => {
        return {
            theme,
            darkMode,
            customIcons: customIconsQuery?.data ?? {},
            hideNodes: displayTable,
            tagGlyphs,
            pzFeatureFlagEnabled: pzFeatureFlag?.enabled,
            collapseLeafNodes,
        };
    }, [theme, darkMode, customIconsQuery.data, displayTable, tagGlyphs, pzFeatureFlag?.enabled, collapseLeafNodes]);

    // Initialize graph data for rendering with sigmajs
    useEffect(() => {
        if (!graphQuery.data) return;

        const graphData = graphQuery.data;

        if (graphOptions.hideNodes) {
            setGraphologyGraph(undefined);
        } else {
            const graph = initGraph(graphData, graphOptions);
            setGraphologyGraph(graph);
        }
    }, [graphQuery.data, graphOptions]);

    /* Legacy view: expand a collapsed group in place and re-run the current layout */
    const expandGroupNode = useCallback(
        (groupId: string) => {
            if (!graphologyGraph || !expandGroup(graphologyGraph, groupId).length) return;
            if (exploreLayout === 'standard') sigmaChartRef.current?.runStandardLayout();
            else sigmaChartRef.current?.runSequentialLayout();
        },
        [graphologyGraph, exploreLayout]
    );

    const handleClickNode = useCallback(
        (id: string) => (isGroupNode(id) ? expandGroupNode(id) : setSelectedItem(id)),
        [expandGroupNode, setSelectedItem]
    );

    // Synthetic group edges have no backing relationship to show in the info panel
    const handleClickEdge = useCallback((id: string) => !isGroupEdge(id) && setSelectedItem(id), [setSelectedItem]);

    // If the selected node is folded into a group (e.g. picked from search), unfold it so it is visible
    useEffect(() => {
        if (!graphologyGraph || !selectedItem || !graphologyGraph.hasNode(selectedItem)) return;
        const groupId = findGroupContaining(graphologyGraph, selectedItem);
        if (groupId) expandGroupNode(groupId);
    }, [graphologyGraph, selectedItem, expandGroupNode]);

    /* useCallback Event Handlers must appear before return statement */
    const handleContextMenu = useCallback(
        (event: SigmaNodeEventPayload) => {
            if (isGroupItem(event.node)) return;
            setSelectedItem(event.node);
            setContextMenu(contextMenu === null ? { mouseX: event.event.x, mouseY: event.event.y } : null);
        },
        [contextMenu, setContextMenu, setSelectedItem]
    );

    /* Passthrough function to munge shared component callback shape into a Sigma Node event-shaped object */
    const handleKebabMenuClick = useCallback(
        (nodeInfo: NodeClickInfo) => {
            if (!nodeInfo.id) return;
            handleContextMenu({ event: { x: nodeInfo.x, y: nodeInfo.y }, node: nodeInfo.id } as SigmaNodeEventPayload);
        },
        [handleContextMenu]
    );

    useKeybindings({
        KeyC: () => {
            if (exploreSearchTab !== 'cypher') {
                setExploreParams({
                    exploreSearchTab: 'cypher',
                });
            }
        },
        Slash: () => {
            if (exploreSearchTab !== 'node') {
                setExploreParams({ exploreSearchTab: 'node' });
            }
        },
        KeyP: () => {
            if (exploreSearchTab !== 'pathfinding') {
                setExploreParams({ exploreSearchTab: 'pathfinding' });
            }
        },
        KeyT: () => {
            dispatch(setIsExploreTableSelected(!isExploreTableSelected));
        },
        KeyI: () => {
            const entries = Object.entries(graphQuery?.data || {});
            const onlyOneNodeInResults = entries.length === 1;

            if (selectedItem) {
                setSelectedItem('');
                // If there is exactly one node and no curretly selected it, select this node
            } else if (onlyOneNodeInResults) {
                const onlyNodeKey = entries?.[0]?.[0];

                setSelectedItem(onlyNodeKey);
            } else {
                setSelectedItem(previousSelectedItem || '');
            }
        },
    });

    const resetLayoutToDefault = useCallback(() => {
        dispatch(setExploreLayout(defaultGraphLayout));
        dispatch(setIsExploreLayoutSelected(false));
        dispatch(setIsExploreTableSelected(false));
    }, [dispatch]);

    const setLayout = useCallback(
        (layout: BaseExploreLayoutOptions) => {
            const isDeselectingTable = layout === 'table' && isExploreTableSelected;
            const isDeselectingLayout = layout !== 'table' && exploreLayout === layout && isExploreLayoutSelected;

            if (isDeselectingTable || isDeselectingLayout) {
                resetLayoutToDefault();
                return;
            }

            if (layout === 'table') {
                dispatch(setIsExploreTableSelected(true));
            } else {
                dispatch(setExploreLayout(layout));
                dispatch(setIsExploreLayoutSelected(true));
                dispatch(setIsExploreTableSelected(false));

                if (layout === 'standard') sigmaChartRef.current?.runStandardLayout();

                if (layout === 'sequential') sigmaChartRef.current?.runSequentialLayout();
            }
        },
        [exploreLayout, dispatch, isExploreTableSelected, isExploreLayoutSelected, resetLayoutToDefault]
    );

    const handleCloseTableView = useCallback(() => {
        setAutoDisplayTable(false);
        dispatch(setIsExploreTableSelected(false));
        if (!isExploreLayoutSelected || !exploreLayout) {
            dispatch(setExploreLayout(defaultGraphLayout));
        }
    }, [setAutoDisplayTable, dispatch, isExploreLayoutSelected, exploreLayout]);

    if (graphHasDataQuery.isLoading) {
        return (
            <div className='relative h-full w-full overflow-hidden' data-testid='explore'>
                {hiddenHeading}
                <GraphProgress loading={graphHasDataQuery.isLoading} />
            </div>
        );
    }

    if (graphHasDataQuery.isError)
        return (
            <>
                {hiddenHeading}
                <GraphViewErrorAlert />
            </>
        );

    if (!isWebGLEnabledMemo)
        return (
            <>
                {hiddenHeading}
                <WebGLDisabledAlert />
            </>
        );

    /* Event Handlers */
    const handleCloseContextMenu = () => {
        setContextMenu(null);
    };

    const handleManageColumnsChange = (columnOptions: ManageColumnsComboBoxOption[]) => {
        const newItems = makeStoreMapFromColumnOptions(columnOptions);

        dispatch(setSelectedExploreTableColumns(newItems));
    };

    const handleChangePinnedColumns = (columns: string[]) => {
        if (columns.includes('action-menu')) {
            columns = columns.filter((item) => item !== 'action-menu');
        }
        dispatch(setPinnedExploreTableColumns(['action-menu', ...columns]));
    };

    return (
        <div
            className='relative h-full w-full overflow-hidden'
            data-testid='explore'
            onContextMenu={(e) => e.preventDefault()}>
            {title}
            {hiddenHeading}
            <SigmaChart
                graph={graphologyGraph}
                highlightedItem={selectedItem}
                onClickEdge={handleClickEdge}
                onClickNode={handleClickNode}
                onClickStage={clearSelectedItem}
                handleContextMenu={handleContextMenu}
                showNodeLabels={showNodeLabels}
                showEdgeLabels={showEdgeLabels}
                ref={sigmaChartRef}
            />

            <div className='absolute top-0 h-full p-4 flex gap-2 justify-between flex-col pointer-events-none'>
                <ExploreSearch />
                <div className='flex gap-1 items-end'>
                    <GraphControls
                        isExploreTableSelected={isExploreTableSelected}
                        isExploreLayoutSelected={isExploreLayoutSelected}
                        layoutOptions={baseGraphLayouts}
                        selectedLayout={exploreLayout ?? defaultGraphLayout}
                        onLayoutChange={setLayout}
                        showNodeLabels={showNodeLabels}
                        onToggleNodeLabels={toggleShowNodeLabels}
                        showEdgeLabels={showEdgeLabels}
                        onToggleEdgeLabels={toggleShowEdgeLabels}
                        jsonData={graphQuery.data}
                        onReset={() => sigmaChartRef.current?.resetCamera()}
                        currentNodes={graphQuery.data?.nodes}
                        onSearchedNodeClick={(node) => {
                            node.id && setSelectedItem(node.id);
                            sigmaChartRef?.current?.zoomTo(node.id);
                        }}
                    />
                    <Tooltip
                        tooltip={collapseLeafNodes ? 'Expand Grouped Nodes' : 'Group Leaf Nodes'}
                        triggerProps={{ className: 'pointer-events-auto' }}
                        contentProps={{ className: 'dark:bg-neutral-4 dark:border-neutral-5 dark:text-white' }}>
                        <div>
                            <IconButton
                                aria-label={collapseLeafNodes ? 'Expand Grouped Nodes' : 'Group Leaf Nodes'}
                                aria-pressed={collapseLeafNodes}
                                onClick={toggleCollapseLeafNodes}
                                className={
                                    collapseLeafNodes ? '!bg-primary !text-white dark:!text-neutral-1' : undefined
                                }
                                data-testid='explore_graph-controls_collapse-leaves-toggle'>
                                <FontAwesomeIcon aria-hidden='true' icon={faLayerGroup} />
                            </IconButton>
                        </div>
                    </Tooltip>
                </div>
            </div>
            <GraphItemInformationPanel />
            <FeatureFlag
                flagKey='tier_management_engine'
                enabled={
                    <ContextMenuPrivilegeZonesEnabled
                        contextMenu={isNodeResponse(selectedItemQuery.data) ? contextMenu : null}
                        onClose={handleCloseContextMenu}
                    />
                }
                disabled={
                    <ContextMenu
                        contextMenu={isNodeResponse(selectedItemQuery.data) ? contextMenu : null}
                        handleClose={handleCloseContextMenu}
                    />
                }
            />

            <GraphProgress loading={graphQuery.isLoading} />
            <NoDataFileUploadDialogWithLinks open={!graphHasDataQuery.data} />
            {displayTable && (
                <ExploreTable
                    selectedColumns={selectedColumns}
                    pinnedColumns={pinnedColumns ?? DEFAULT_PINNED_COLUMN_KEYS}
                    onManageColumnsChange={handleManageColumnsChange}
                    onKebabMenuClick={handleKebabMenuClick}
                    onChangePinnedColumns={handleChangePinnedColumns}
                    onClose={handleCloseTableView}
                />
            )}
        </div>
    );
};

export default GraphView;
