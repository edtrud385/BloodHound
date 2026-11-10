# Legacy view for BloodHound CE

This branch (`legacy-view`, based on CE `v9.8.0`) changes **only how the Explore graph is drawn**.
Ingest, post-processing, edge creation, Tier Zero tagging, the API and storage are untouched, so
it works the same whether CE stores its graph in Neo4j or PostgreSQL.

## What changes

| Goal | How |
| --- | --- |
| Left-to-right, whole graph on one screen | The dagre layout is stretched to the screen's shape (`stretchToAspect`), so ranks spread across the full width and the tallest rank fills the height. Reset always fits the visible graph, and the zoom-out cap is raised from 15 to 500. |
| Readable at full zoom-out | Nodes and labels keep a readable size at the fitted view and grow smoothly as you zoom in (like Legacy), reaching CE's normal size at 1:1. Labels are single-line (no "Active Directory \| User" sublabel), and are only dropped where they would sit almost exactly on top of each other. The **A−/A+** buttons next to the graph controls make node and edge labels smaller or bigger (remembered in your browser). |
| Less clutter | Legacy-style node collapse: when a node has 5 or more leaf neighbours, the leaves are hidden and the node shows a black count bubble. **Double-click** the node to expand them and re-run the layout, or **right-click → Expand N collapsed nodes** to expand them in place: the rest of the graph and the camera stay put and the leaves are laid out in one column beside their parent, squeezed to fit the visible screen and set as far out as it allows (not counting the entity panel), like Legacy; when the parent is the only other node on screen it moves to the edge so the fan spans the full width. Zoom in to separate names. **Right-click → Collapse N nodes** folds them back. The layer button turns collapsing off and on, and selecting a hidden node (for example from search) expands its parent. |
| Path highlight | CE 9.x dims everything that isn't on a path through the selected node. The route button toggles that on and off (CE has the setting but no button for it). |
| Legacy-style look | Icons are drawn at 75% of CE's size and node labels in regular weight so names stand out, and edges taper from a wider source end to a narrower target end. No white box behind node or edge labels. Edge labels are drawn along the edge, just above the line, and never upside down; they get the same readable-size floor as node labels. Parallel edges between the same two nodes are spread so each label sits on its own curve. A selected node's label shows in the highlight color. |
| Bug fixes (upstream) | Hidden nodes are zeroed for the whole triangle in the node and glyph WebGL programs (upstream zeroed one vertex, which drew stray wedges). Each node program binds its own icon texture before drawing (upstream used whatever was bound last, so icons vanished on hover or selection). Drag state is kept in a ref, so a quick click can no longer leave a node stuck to the mouse. Hidden edges are no longer clickable. Curved (parallel) edges were looked up by their `rel_<id>` key as if it were `source_kind_target`, so they never got their own curve; they are now looked up by `exploreGraphId`. |

Nearly all of the logic is in `cmd/ui/src/rendering/legacyView.ts`, with small hooks in the files it
plugs into. That keeps rebases onto new CE releases small. Tunables (collapse threshold, size and label
floors, declutter, label boxes, sublabels, edge-label style) are constants in that file.

Full node names: CE truncates long labels by default. Turn that off with CE's own "label clipping"
setting if you want Legacy's full names.

## Query sets and pickers

The Saved Queries panel has a **Sophos Queries / BloodHound CE** switch (remembered in your browser).
BloodHound CE lists CE's own built-in queries; Sophos Queries lists a local set of review queries. Your
saved queries show under both. The Platforms filter picks Active Directory or Entra ID, and the
Categories list only offers that platform's categories.

The Sophos set lives in `packages/javascript/bh-shared-ui/src/commonSearchesSophos.ts`. The repository
copy is empty on purpose: the real queries are generated locally and never committed (the file is
marked `skip-worktree`, so git ignores the local copy).

Pre-built queries can carry a Legacy-style **picker** (`QueryPicker` in `types.ts`): clicking the query
opens a dialog such as "Select a Domain..." that lists the nodes its `options` query returns (with a single
option it just runs). Choosing
one runs the picker's query with `$result` replaced by that node's name; **Run for all** runs the query
as listed.

This UI expects a CE 9.x server. Against CE 8.x the node panel and the right-click menu stay empty,
because 8.x has no `/api/v2/nodes/{id}` endpoint. Graphs still draw: 8.x sends edges without ids, and
the UI falls back to a source/kind/target key for them.

## Edge filter

The filter button at the right end of the Search / Pathfinding / Cypher tab bar opens a Legacy-style **Edge Filter**. It lists only the edge
types in the current graph, with counts, grouped like CE's pathfinding filter. Unticking a type hides
those edges at once; **Hide nodes left without edges** also hides nodes that only had hidden edges.
**Apply filter to every query** goes further, like Legacy: the unticked types are removed from every
multi-type edge list in the Cypher query (`-[:A|B|C*1..]->`) and the query re-runs, so paths around them
show up. Single-type patterns such as `-[:HasSession]->` are left as written. The current ticks can be
saved as named **views**. The filter and views are kept in your browser.

## Large queries (server config, no code change)

CE has no row cap on Cypher results. Large queries are cut off by three server limits, all
configurable:

```yaml
# docker-compose.yml, bloodhound service, environment:
bhe_disable_cypher_complexity_limit: "true"   # default false: rejects "complex" queries
bhe_graph_query_memory_limit: 8               # GiB, default 2
```

Query timeout: in **Administration → Configuration**, turn off the Explore query timeout limit, then
enable the per-user "disable query limit" toggle in the Cypher panel (the UI then sends `Prefer: wait=-1`).

## Building

```bash
node .yarn/releases/yarn-4.13.0.cjs install
cd cmd/ui && node ../../.yarn/releases/yarn-4.13.0.cjs dev   # proxies the API to localhost:8080
```

To ship it, build the normal CE image from this branch (`dockerfiles/bloodhound.Dockerfile`) and use
that image in place of `specterops/bloodhound` in your compose file.
