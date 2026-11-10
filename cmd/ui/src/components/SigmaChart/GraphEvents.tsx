// Copyright 2025 Specter Ops, Inc.
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

import { useRegisterEvents, useSetSettings, useSigma } from '@react-sigma/core';
import { useTheme } from 'bh-shared-ui';
import type { Attributes } from 'graphology-types';
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { SigmaNodeEventPayload } from 'sigma/sigma';
import type { Coordinates } from 'sigma/types';
import {
    DRAG_THRESHOLD,
    MOUSE_BUTTON_PRIMARY,
    getDistanceBetween,
    getEdgeDataFromKey,
    getEdgeSourceAndTargetDisplayData,
    getNodeOffset,
    graphToFramedGraph,
    resetCamera,
} from 'src/ducks/graph/utils';
import {
    LABEL_DECLUTTER_RATIO,
    NODE_ICON_SCALE,
    ViewBounds,
    drawCollapsedBadges,
    getDeclutteredLabels,
    getLabelScale,
    getNodeSizeBoost,
} from 'src/rendering/legacyView';
import { bezier } from 'src/rendering/utils/bezier';
import { blendHexColors, getNodeRadius } from 'src/rendering/utils/utils';
import { useAppSelector } from 'src/store';
import { preventAllDefaults } from 'src/utils';
import { sequentialLayout, standardLayout } from 'src/views/Explore/utils';
import { getFullPathHighlightedEntities, getIsHighlightedItemInGraph } from './utils';

interface SigmaChartRef {
    resetCamera: () => void;
    refresh: () => void;
    /** The part of the graph currently on screen, in graph coordinates. */
    getViewBounds: () => ViewBounds;
    zoomTo: (id: string) => void;
    runSequentialLayout: () => void;
    runStandardLayout: () => void;
}

interface GraphEventProps {
    highlightedItem: string | null;
    onClickNode?: (id: string) => void;
    onDoubleClickNode?: (id: string) => void;
    onClickStage?: () => void;
    onRightClickNode?: (event: SigmaNodeEventPayload) => void;
    showNodeLabels?: boolean;
    showEdgeLabels?: boolean;
}

/** Meta info about the currently dragged node */
type DragMetadata = {
    /**
     * If node has been dragged outside of threshold, then click is cancelled
     * so node is not selected.
     */
    cancelNextClick: boolean;

    /** Id of the dragged graph node. */
    id: string | null;

    /**
     * Vector from node's center to cusor position at mouse down. Used to
     * prevent the node from jumping to the cursor at drag start.
     */
    offset: Coordinates | null;

    /** Node's original position, for determining how far it's been dragged. */
    origin: Coordinates | null;
};

const DEFAULT_DRAGGED_META = {
    id: null,
    cancelNextClick: false,
    offset: null,
    origin: null,
};

export const GraphEvents = forwardRef(function GraphEvents(
    {
        highlightedItem,
        onClickNode,
        onDoubleClickNode,
        onClickStage,
        onRightClickNode,
        showNodeLabels = true,
        showEdgeLabels = true,
    }: GraphEventProps,
    ref
) {
    const exploreLayout = useAppSelector((state) => state.global.view.exploreLayout);
    const darkMode = useAppSelector((state) => state.global.view.darkMode);
    const theme = useTheme();
    const isExploreGraphHighlight = useAppSelector((state) => state.global.view.isExploreGraphHighlight);
    const isExploreGraphLabelClip = useAppSelector((state) => state.global.view.isExploreGraphLabelClip);

    const sigma = useSigma();
    const graph = sigma.getGraph();

    // Dev-only handle for inspecting the renderer from the browser console
    if (import.meta.env.DEV) (window as any).__bhSigma = sigma;

    const registerEvents = useRegisterEvents();
    const setSettings = useSetSettings();

    // Drag state lives in a ref, not React state: event handlers must see the current drag at once.
    // With state, a fast click could reach a stale mouseup handler that thought nothing was dragged,
    // leaving the drag active so the next node under the cursor followed the mouse.
    const dragRef = useRef<DragMetadata>(DEFAULT_DRAGGED_META);
    // Only used to pause edge labels while a node is actually being moved
    const [isDragging, setIsDragging] = useState(false);

    const endDrag = useCallback(() => {
        if (!dragRef.current.id) return;
        // Keep cancelNextClick until the click event that follows this mouseup has been handled
        const cancelNextClick = dragRef.current.cancelNextClick;
        dragRef.current = { ...DEFAULT_DRAGGED_META, cancelNextClick };
        setIsDragging(false);
        setTimeout(() => (dragRef.current = { ...dragRef.current, cancelNextClick: false }), 0);
    }, []);

    // Mouse released outside the graph canvas must also end a drag
    useEffect(() => {
        window.addEventListener('mouseup', endDrag);
        return () => window.removeEventListener('mouseup', endDrag);
    }, [endDrag]);

    const sigmaChartRef = ref as React.MutableRefObject<SigmaChartRef | null>;

    useImperativeHandle(sigmaChartRef, () => {
        return {
            zoomTo: (id: string) => {
                const node = sigma.getNodeDisplayData(id);

                if (node) {
                    sigma.getCamera().animate(
                        {
                            x: node?.x,
                            y: node?.y,
                            ratio: 1,
                        },
                        {
                            easing: 'quadraticOut',
                        },
                        () => {
                            sigma.scheduleRefresh();
                        }
                    );
                }
            },
            resetCamera: () => {
                resetCamera(sigma);
            },
            refresh: () => sigma.refresh(),
            getViewBounds: () => {
                const { width, height } = sigma.getDimensions();
                // The entity panel sits over the right of the graph; don't count the area behind it
                let right = width;
                const container = sigma.getContainer().getBoundingClientRect();
                const panel = document
                    .querySelector('[data-testid="explore_entity-information-panel"]')
                    ?.getBoundingClientRect();
                if (panel && panel.width > 0 && panel.left > container.left + width / 2) {
                    right = Math.min(width, panel.left - container.left - 16);
                }
                const a = sigma.viewportToGraph({ x: 0, y: 0 });
                const b = sigma.viewportToGraph({ x: right, y: height });
                return {
                    xMin: Math.min(a.x, b.x),
                    xMax: Math.max(a.x, b.x),
                    yMin: Math.min(a.y, b.y),
                    yMax: Math.max(a.y, b.y),
                };
            },

            runSequentialLayout: () => {
                const { width, height } = sigma.getDimensions();
                sequentialLayout(graph, height ? width / height : undefined);
                resetCamera(sigma);
            },
            runStandardLayout: () => {
                standardLayout(graph);
                resetCamera(sigma);
            },
        };
    }, [sigma, graph]);

    const sigmaContainer = document.getElementById('sigma-container');
    const { getControlAtMidpoint, getLineLength, calculateCurveHeight } = bezier;

    const curvedEdgeReducer = useCallback(
        (edge: string, data: Attributes, newData: Attributes) => {
            // We calculate control points for all curved edges here and pass those along as edge attributes in both viewport and framed graph
            // coordinates. We can then use those control points in our edge, edge label, and edge arrow programs.
            const edgeData = getEdgeDataFromKey(edge);
            if (edgeData !== null) {
                const nodeDisplayData = getEdgeSourceAndTargetDisplayData(edgeData.source, edgeData.target, sigma);
                if (nodeDisplayData !== null) {
                    const sourceCoordinates = { x: nodeDisplayData.source.x, y: nodeDisplayData.source.y };
                    const targetCoordinates = { x: nodeDisplayData.target.x, y: nodeDisplayData.target.y };

                    const height = calculateCurveHeight(data.groupSize, data.groupPosition, data.direction);
                    const control = getControlAtMidpoint(height, sourceCoordinates, targetCoordinates);

                    newData.control = control;
                    newData.controlInViewport = sigma.framedGraphToViewport(control);
                }
            }
        },
        [sigma, calculateCurveHeight, getControlAtMidpoint]
    );

    const selfEdgeReducer = useCallback(
        (edge: string, newData: Attributes) => {
            const edgeData = getEdgeDataFromKey(edge);
            if (edgeData !== null) {
                const nodeDisplayData = getEdgeSourceAndTargetDisplayData(edgeData.source, edgeData.target, sigma);
                if (nodeDisplayData !== null) {
                    const nodeRadius = getNodeRadius(false, newData.inverseSqrtZoomRatio, nodeDisplayData.source.size);

                    const framedGraphNodeRadius = getLineLength(
                        graphToFramedGraph(sigma, { x: 0, y: 0 }),
                        graphToFramedGraph(sigma, { x: nodeRadius, y: nodeRadius })
                    );

                    newData.framedGraphNodeRadius = framedGraphNodeRadius;
                }
            }
        },
        [sigma, getLineLength]
    );

    useEffect(() => {
        registerEvents({
            enterNode: () => {
                if (sigmaContainer) sigmaContainer.style.cursor = 'grab';
            },
            leaveNode: () => {
                if (sigmaContainer) sigmaContainer.style.cursor = 'default';
            },
            downNode: (event) => {
                if (event.event.original.button === MOUSE_BUTTON_PRIMARY) {
                    const node = graph.getNodeAttributes(event.node);
                    dragRef.current = {
                        cancelNextClick: false,
                        id: event.node,
                        offset: getNodeOffset(node, sigma.viewportToGraph(event.event)),
                        origin: { x: node.x, y: node.y },
                    };
                }
            },
            mouseup: endDrag,
            mousemovebody: (event) => {
                const draggedMeta = dragRef.current;
                if (draggedMeta.id && draggedMeta.offset && graph.hasNode(draggedMeta.id)) {
                    // Get new position of node
                    const position = sigma.viewportToGraph(event);

                    // Prevent Sigma from moving camera
                    preventAllDefaults(event);

                    // DRAG_THRESHOLD
                    const newPosition = {
                        x: position.x - draggedMeta.offset.x,
                        y: position.y - draggedMeta.offset.y,
                    };

                    // Determine if node has been dragged past click-cancel threshold
                    if (!draggedMeta.cancelNextClick && draggedMeta.origin) {
                        const dragDistance = getDistanceBetween(draggedMeta.origin, newPosition);
                        if (dragDistance > DRAG_THRESHOLD) {
                            dragRef.current = { ...draggedMeta, cancelNextClick: true };
                            setIsDragging(true);
                        }
                    }

                    graph.setNodeAttribute(draggedMeta.id, 'x', newPosition.x);
                    graph.setNodeAttribute(draggedMeta.id, 'y', newPosition.y);
                }
            },
            doubleClickNode: (event) => {
                // Prevent zoom when node is double clicked
                preventAllDefaults(event);
                onDoubleClickNode?.(event.node);
            },
            doubleClick: (event) => {
                // Prevent zoom when graph is double clicked
                preventAllDefaults(event);
            },
            clickNode: (event) => {
                if (dragRef.current.cancelNextClick) {
                    // The node was dragged: skip the click so it is not selected
                    dragRef.current = { ...dragRef.current, cancelNextClick: false };
                } else {
                    onClickNode?.(event.node);
                }
            },
            rightClickNode: (event) => {
                preventAllDefaults(event);
                onRightClickNode?.(event);
            },
            // Reducers must run again on camera state update to position edge labels correctly
            // Despite the name, this event only triggers on camera update, not any Sigma update
            updated: () => sigma.refresh(),
            clickStage: () => onClickStage?.(),
        });
    }, [
        endDrag,
        graph,
        onClickNode,
        onDoubleClickNode,
        onClickStage,
        onRightClickNode,
        registerEvents,
        sigma,
        sigmaContainer,
    ]);

    // Legacy view: expanding or folding leaves changes which nodes are drawn without replacing the graph,
    // so recompute the path highlight whenever the layout version changes.
    const [layoutVersion, setLayoutVersion] = useState(0);
    useEffect(() => {
        const update = () => setLayoutVersion(graph.getAttribute('layoutVersion') ?? 0);
        graph.on('attributesUpdated', update);
        return () => {
            graph.removeListener('attributesUpdated', update);
        };
    }, [graph]);

    const isHighlightedItemInGraph = useMemo(
        () => getIsHighlightedItemInGraph(graph, highlightedItem),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [graph, highlightedItem, layoutVersion]
    );

    const { highlightedNodeIds, highlightedEdgeIds } = useMemo(
        () => getFullPathHighlightedEntities(graph, highlightedItem),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [graph, highlightedItem, layoutVersion]
    );

    useEffect(() => {
        const bgColor = theme.neutral.primary;
        // dimFactor is how much of the original color shows through (1 = full, 0 = fully hidden).
        // Equivalent to 1 - nodeBlend from the old CPU-blend approach: dark 1-0.5=0.5, light 1-0.8=0.2.
        const nodeDimFactor = darkMode ? 0.5 : 0.2;
        const edgeBlend = darkMode ? 0.6 : 0.9;
        const labelDimFactor = darkMode ? 0.3 : 0.1;

        setSettings({
            nodeReducer: (node, data) => {
                const camera = sigma.getCamera();
                const isDimmed =
                    isExploreGraphHighlight !== false &&
                    !!highlightedItem &&
                    !highlightedNodeIds.has(node) &&
                    isHighlightedItemInGraph;

                const inverseSqrtZoomRatio = 1 / Math.sqrt(camera.ratio);

                return {
                    ...data,
                    // Legacy view: keep a minimum on-screen node size and a readable label size when zoomed out
                    size: (data.size ?? 0) * getNodeSizeBoost(camera.ratio) * NODE_ICON_SCALE,
                    labelScale: getLabelScale(inverseSqrtZoomRatio),
                    forceLabel:
                        data.forceLabel &&
                        (camera.ratio <= LABEL_DECLUTTER_RATIO ||
                            node === highlightedItem ||
                            getDeclutteredLabels(graph, camera.ratio).has(node)),
                    highlighted: node === highlightedItem,
                    isExploreGraphLabelClip,
                    inverseSqrtZoomRatio,
                    isDimmed,
                    // Always pass the canvas background color so the shader can dim toward it.
                    graphBgColor: bgColor,
                    ...(isDimmed && {
                        labelDimFactor,
                        dimFactor: nodeDimFactor,
                        // Keep label background dimmed — labels are rendered on canvas 2D, not by the shader.
                        backgroundColor: blendHexColors(data.backgroundColor ?? bgColor, bgColor, 1 - nodeDimFactor),
                    }),
                };
            },
            edgeReducer: (edge, data) => {
                const camera = sigma.getCamera();
                const isDimmed =
                    isExploreGraphHighlight !== false &&
                    !!highlightedItem &&
                    !highlightedEdgeIds.has(edge) &&
                    isHighlightedItemInGraph;

                const newData: Attributes = {
                    ...data,
                    // Hide edges whose endpoint is folded into a collapsed group (some custom edge programs
                    // ignore sigma's hidden-extremity check)
                    hidden: graph.extremities(edge).some((node) => graph.getNodeAttribute(node, 'hidden')),
                    highlighted: edge === highlightedItem,
                    inverseSqrtZoomRatio: 1 / Math.sqrt(camera.ratio),
                    isDimmed,
                    backgroundColor: bgColor,
                    ...(isDimmed && {
                        labelDimFactor,
                        color: blendHexColors(data.color, bgColor, edgeBlend),
                    }),
                };

                if (data.type === 'curved') {
                    curvedEdgeReducer(edge, data, newData);
                } else if (data.type === 'self') {
                    selfEdgeReducer(edge, newData);
                }

                return newData;
            },
        });
    }, [
        curvedEdgeReducer,
        darkMode,
        graph,
        highlightedEdgeIds,
        highlightedItem,
        highlightedNodeIds,
        selfEdgeReducer,
        setSettings,
        sigma,
        theme.neutral.primary,
        isHighlightedItemInGraph,
        isExploreGraphHighlight,
        isExploreGraphLabelClip,
    ]);

    // Legacy view: draw the count bubble on nodes with collapsed leaves after every render
    useEffect(() => {
        const draw = () => drawCollapsedBadges(sigma);
        sigma.on('afterRender', draw);
        return () => {
            sigma.removeListener('afterRender', draw);
        };
    }, [sigma]);

    // Toggle off edge labels when dragging a node to avoid performance hit
    useLayoutEffect(() => {
        setSettings({ renderEdgeLabels: isDragging ? false : showEdgeLabels });
    }, [isDragging, setSettings, showEdgeLabels]);

    useLayoutEffect(() => {
        if (sigmaChartRef?.current) {
            if (exploreLayout === 'sequential') {
                sigmaChartRef?.current?.runSequentialLayout();
            } else if (exploreLayout === 'standard') {
                sigmaChartRef?.current?.runStandardLayout();
            } else {
                resetCamera(sigma);
            }
        } else {
            resetCamera(sigma);
        }
    }, [sigma, exploreLayout, sigmaChartRef]);

    useLayoutEffect(() => {
        setSettings({
            renderLabels: showNodeLabels,
            renderEdgeLabels: showEdgeLabels,
        });
    }, [setSettings, showNodeLabels, showEdgeLabels]);

    return null;
});
