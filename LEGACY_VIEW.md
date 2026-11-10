# Legacy view for BloodHound CE

This branch (`legacy-view`, based on CE `v9.8.0`) changes **only how the Explore graph is drawn**.
Ingest, post-processing, edge creation, Tier Zero tagging, the API and storage are untouched, so
it works the same whether CE stores its graph in Neo4j or PostgreSQL.

## What changes

| Goal | How |
| --- | --- |
| Left-to-right, whole graph on one screen | The dagre layout is stretched to the screen's shape (`stretchToAspect`), so ranks spread across the full width and the tallest rank fills the height. Reset always fits the visible graph, and the zoom-out cap is raised from 15 to 500. |
| Readable at full zoom-out | Nodes keep a minimum on-screen size, labels keep a ~10px floor and never fade out, and labels are single-line (no "Active Directory \| User" sublabel). When zoomed out, labels are only dropped where they would sit almost exactly on top of each other (groups and the most-connected nodes win), so nearly every name stays visible. |
| Less clutter | Leaf nodes that hang off the same parent through the same relationship fold into a group node ("412 Users"), like Legacy's node collapse (threshold 5). Click a group to expand it. The layer button next to the graph controls turns grouping off and on. Selecting a folded node (for example from search) unfolds its group. |
| Legacy-style labels | No white box behind node or edge labels. Edge labels are drawn along the edge, just above the line, and never upside down; they get the same readable-size floor as node labels. A selected node's label shows in the highlight color. |
| Bug fixes (upstream) | Hidden nodes are zeroed for the whole triangle in the node and glyph WebGL programs (upstream zeroed one vertex, which drew stray wedges). Each node program binds its own icon texture before drawing (upstream used whatever was bound last, so icons vanished on hover or selection). |

Nearly all of the logic is in `cmd/ui/src/rendering/legacyView.ts`, with small hooks in the files it
plugs into. That keeps rebases onto new CE releases small. Tunables (collapse threshold, size and label
floors, declutter, label boxes, sublabels, edge-label style) are constants in that file.

Full node names: CE truncates long labels by default. Turn that off with CE's own "label clipping"
setting if you want Legacy's full names.

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
