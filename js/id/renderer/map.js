iD.Map = function() {
    var connection, history,
        dimensions = [],
        dispatch = d3.dispatch('move'),
        inspector = iD.Inspector(),
        selection = null,
        translateStart,
        apiTilesLoaded = {},
        projection = d3.geo.mercator(),
        zoom = d3.behavior.zoom()
            .translate(projection.translate())
            .scale(projection.scale())
            .scaleExtent([1024, 256 * Math.pow(2, 24)])
            .on('zoom', zoomPan),
        dblclickEnabled = true,
        dragging,
        dragbehavior = d3.behavior.drag()
            .origin(function(entity) {
                if (entity.accuracy) {
                    var index = entity.index, wayid = entity.way;
                    entity = iD.Node(entity);
                    var connectedWay = map.history.graph().entity(wayid);
                    connectedWay.nodes.splice(index, 0, entity.id);
                    map.perform(iD.actions.addWayNode(connectedWay, entity));
                }
                var p = projection(ll2a(entity));
                return { x: p[0], y: p[1] };
            })
            .on('drag', function(entity) {
                d3.event.sourceEvent.stopPropagation();

                if (!dragging) {
                    dragging = iD.Util.trueObj([entity.id].concat(
                        _.pluck(history.graph().parents(entity.id), 'id')));
                    history.perform(iD.actions.noop());
                }

                var to = projection.invert([d3.event.x, d3.event.y]);
                history.replace(iD.actions.move(entity, to));

                redraw();
            })
            .on('dragend', function () {
                if (dragging) {
                    dragging = undefined;
                    redraw();
                }
            }),
        waydragbehavior = d3.behavior.drag()
            .origin(function(entity) {
                var p = projection(ll2a(entity.nodes[0]));
                return { x: p[0], y: p[1] };
            })
            .on('drag', function(entity) {
                d3.event.sourceEvent.stopPropagation();

                if (!dragging) {
                    dragging = iD.Util.trueObj([entity.id].concat(
                        _.pluck(history.graph().parents(entity.id), 'id')));
                    history.perform(iD.actions.noop());
                }

                entity.nodes.forEach(function(node) {
                    var start = projection(ll2a(node));
                    var end = projection.invert([start[0] + d3.event.dx, start[1] + d3.event.dy]);
                    node.lon = end[0];
                    node.lat = end[1];
                    history.replace(iD.actions.move(node, end));
                });
            })
            .on('dragend', function () {
                if (dragging) {
                    dragging = undefined;
                    redraw();
                }
            }),
        nodeline = function(d) {
            return 'M' + d.nodes.map(ll2a).map(projection).map(roundCoords).join('L');
        },
        getline = function(d) { return d._line; },
        key = function(d) { return d.id; },
        background = iD.Background()
            .projection(projection)
            .scaleExtent([0, 20]),
        class_stroke = iD.Style.styleClasses('stroke'),
        class_fill = iD.Style.styleClasses('stroke'),
        class_area = iD.Style.styleClasses('area'),
        class_casing = iD.Style.styleClasses('casing'),
        prefix = prefixMatch(['webkit', 'ms', 'Moz', 'O']),
        transformProp = prefix + 'transform',
        supersurface, surface, defs, tilegroup, r, g, alength;

    function map() {
        supersurface = this.append('div').call(zoom);

        surface = supersurface.append('svg')
            .on('mouseup', resetTransform)
            .on('touchend', resetTransform);

        defs = surface.append('defs');
        defs.append('clipPath')
                .attr('id', 'clip')
            .append('rect')
                .attr('id', 'clip-rect')
                .attr({ x: 0, y: 0 });

        tilegroup = surface.append('g')
            .attr('clip-path', 'url(#clip)')
            .on('click', deselectClick);

        r = surface.append('g')
            .on('click', selectClick)
            .on('mouseover', nameHoverIn)
            .on('mouseout', nameHoverOut)
            .attr('clip-path', 'url(#clip)');

        g = ['fill', 'casing', 'stroke', 'text', 'hit', 'temp'].reduce(function(mem, i) {
            return (mem[i] = r.append('g').attr('class', 'layer-g')) && mem;
        }, {});

        var arrow = surface.append('text').text('►----');
        alength = arrow.node().getComputedTextLength();
        arrow.remove();

        map.size(this.size());
        map.surface = surface;
    }

    function prefixMatch(p) { // via mbostock
        var i = -1, n = p.length, s = document.body.style;
        while (++i < n) if (p[i] + 'Transform' in s) return '-' + p[i].toLowerCase() + '-';
        return '';
    }
    function ll2a(o) { return [o.lon, o.lat]; }
    function roundCoords(c) { return [Math.floor(c[0]), Math.floor(c[1])]; }

    function hideInspector() {
        d3.select('.inspector-wrap').style('display', 'none');
    }

    function classActive(d) { return d.id === selection; }

    function nodeIntersect(entity, extent) {
        return entity.lon > extent[0][0] &&
            entity.lon < extent[1][0] &&
            entity.lat < extent[0][1] &&
            entity.lat > extent[1][1];
    }

    function isArea(a) {
        return iD.Way.isClosed(a) || (a.tags.area && a.tags.area === 'yes');
    }

    function drawVector(only) {
        if (surface.style(transformProp) != 'none') return;
        var all = [], ways = [], areas = [], points = [], waynodes = [],
            extent = map.extent(),
            graph = history.graph();

        if (!only) {
            all = graph.intersects(extent);
        } else {
            for (var id in only) all.push(graph.fetch(id));
        }

        var filter = only ?
            function(d) { return only[d.id]; } : function() { return true; };

        if (all.length > 2000) {
            return hideVector();
        }

        for (var i = 0; i < all.length; i++) {
            var a = all[i];
            if (a.type === 'way') {
                a._line = nodeline(a);
                if (isArea(a)) areas.push(a);
                else ways.push(a);
            } else if (a._poi) {
                points.push(a);
            } else if (!a._poi && a.type === 'node' && nodeIntersect(a, extent)) {
                waynodes.push(a);
            }
        }
        var wayAccuracyHandles = ways.reduce(function(mem, w) {
            return mem.concat(accuracyHandles(w));
        }, []);
        drawHandles(waynodes, filter);
        drawAccuracyHandles(wayAccuracyHandles, filter);
        drawCasings(ways, filter);
        drawFills(areas, filter);
        drawStrokes(ways, filter);
        drawMarkers(points, filter);
    }

    function accuracyHandles(way) {
        var handles = [];
        for (var i = 0; i < way.nodes.length - 1; i++) {
            handles[i] = iD.Node(iD.Util.interp(way.nodes[i], way.nodes[i + 1], 0.5));
            handles[i].way = way.id;
            handles[i].index = i + 1;
            handles[i].accuracy = true;
            handles[i].tags = { name: 'Improve way accuracy' };
        }
        return handles;
    }

    function drawHandles(waynodes, filter) {
        var handles = g.hit.selectAll('image.handle')
            .filter(filter)
            .data(waynodes, key);
        handles.exit().remove();
        handles.enter().append('image')
            .attr({ width: 6, height: 6, 'class': 'handle', 'xlink:href': 'css/handle.png' })
            .call(dragbehavior);
        handles.attr('transform', function(entity) {
            var p = projection(ll2a(entity));
            return 'translate(' + [~~p[0], ~~p[1]] + ') translate(-3, -3) rotate(45, 3, 3)';
        }).classed('active', classActive);
    }

    function drawAccuracyHandles(waynodes) {
        var handles = g.hit.selectAll('circle.accuracy-handle')
            .data(waynodes, key);
        handles.exit().remove();
        handles.enter().append('circle')
            .attr({ r: 2, 'class': 'accuracy-handle' })
            .call(dragbehavior);
        handles.attr('transform', function(entity) {
            var p = projection(ll2a(entity));
            return 'translate(' + [~~p[0], ~~p[1]] + ')';
        }).classed('active', classActive);
    }

    function hideVector() {
        surface.selectAll('.layer-g *').remove();
    }

    function drawFills(areas, filter) {
        var fills = g.fill.selectAll('path')
            .filter(filter)
            .data(areas, key);
        fills.exit().remove();
        fills.enter().append('path')
            .attr('class', class_area)
            .classed('active', classActive);
        fills
            .attr('d', getline)
            .attr('class', class_area)
            .classed('active', classActive);
    }

    function drawMarkers(points, filter) {
        var markers = g.hit.selectAll('g.marker')
            .filter(filter)
            .data(points, key);
        markers.exit().remove();
        var marker = markers.enter().append('g')
            .attr('class', 'marker')
            .call(dragbehavior);
        marker.append('circle')
            .attr({ r: 10, cx: 8, cy: 8 });
        marker.append('image')
            .attr({ width: 16, height: 16 });
        markers.attr('transform', function(d) {
                var pt = projection([d.lon, d.lat]);
                return 'translate(' + [~~pt[0], ~~pt[1]] + ') translate(-8, -8)';
            })
            .classed('active', classActive);
        markers.select('image').attr('xlink:href', iD.Style.markerimage);
    }

    function isOneWay(d) { return d.tags.oneway && d.tags.oneway === 'yes'; }
    function drawStrokes(ways, filter) {
        var strokes = g.stroke.selectAll('path')
            .filter(filter)
            .data(ways, key);
        strokes.exit().remove();
        strokes.enter().append('path')
            .attr('class', class_stroke)
            .classed('active', classActive);
        strokes
            .order()
            .attr('d', getline)
            .attr('class', class_stroke)
            .classed('active', classActive);

        // Determine the lengths of oneway paths
        var lengths = {},
            oneways = strokes.filter(isOneWay).each(function(d) {
                lengths[d.id] = Math.floor(this.getTotalLength() / alength);
            }).data();

        var uses = defs.selectAll('path')
            .data(oneways, key);
        uses.exit().remove();
        uses.enter().append('path');
        uses
            .attr('id', function(d) { return 'shadow-' + d.id; })
            .attr('d', getline);

        var labels = g.text.selectAll('text')
            .data(oneways, key);
        labels.exit().remove();
        var tp = labels.enter()
            .append('text').attr({ 'class': 'oneway', dy: 4 })
            .append('textPath').attr('class', 'textpath');
        g.text.selectAll('.textpath')
            .attr('xlink:href', function(d, i) { return '#shadow-' + d.id; })
            .text(function(d) {
                return (new Array(Math.floor(lengths[d.id]))).join('►----');
            });
    }

    function drawCasings(ways, filter) {
        var casings = g.casing.selectAll('path')
            .filter(filter)
            .data(ways, key);
        casings.exit().remove();
        casings.enter().append('path')
            .attr('class', class_casing)
            .classed('active', classActive);
        casings
            .order()
            .attr('d', getline)
            .attr('class', class_casing)
            .classed('active', classActive);
    }

    map.size = function(_) {
        if (!arguments.length) return dimensions;
        dimensions = _;
        surface
            .size(dimensions)
            .selectAll('#clip-rect')
            .size(dimensions);
        background.size(dimensions);
        return redraw();
    };

    function connectionLoad(err, result) {
        history.merge(result);
        drawVector(iD.Util.trueObj(Object.keys(result.entities)));
    }

    function nameHoverIn() {
        var entity = d3.select(d3.event.target).data();
        if (entity) d3.select('.messages').text(entity[0].tags.name || '#' + entity[0].id);
    }

    function nameHoverOut() { d3.select('.messages').text(''); }

    function deselectClick() {
        var hadSelection = !!selection;
        if (hadSelection) {
            if (selection.type === 'way') {
                d3.select(d3.event.target)
                    .on('mousedown.drag', null)
                    .on('touchstart.drag', null);
            }
            redraw();
            hideInspector();
        }
        selection = null;
    }

    function selectEntity(entity) {
        selection = entity.id;
        d3.select('.inspector-wrap')
            .style('display', 'block')
            .datum(history.graph().fetch(entity.id))
            .call(inspector);
        redraw();
    }

    function selectClick() {
        var entity = d3.select(d3.event.target).data();
        if (entity) entity = entity[0];
        if (!entity || selection === entity.id || (entity.tags && entity.tags.elastic)) return;
        if (entity.type === 'way') d3.select(d3.event.target).call(waydragbehavior);
        selectEntity(entity);
    }

    function removeEntity(entity) {
        // Remove this node from any ways that is a member of
        history.graph().parents(entity.id)
            .filter(function(d) { return d.type === 'way'; })
            .forEach(function(parent) {
                parent.nodes = _.without(parent.nodes, entity.id);
                history.perform(iD.actions.removeWayNode(parent, entity));
            });
        history.perform(iD.actions.remove(entity));
    }

    inspector.on('changeTags', function(d, tags) {
        var entity = history.graph().entity(d.id);
        history.perform(iD.actions.changeTags(entity, tags));
    }).on('changeWayDirection', function(d) {
        history.perform(iD.actions.changeWayDirection(d));
    }).on('remove', function(d) {
        removeEntity(d);
        hideInspector();
    }).on('close', function() {
        deselectClick();
        hideInspector();
    });

    function zoomPan() {
        if (d3.event && d3.event.sourceEvent.type === 'dblclick') {
            if (!dblclickEnabled) return;
        }
        var fast = (d3.event.scale === projection.scale());
        projection
            .translate(d3.event.translate)
            .scale(d3.event.scale);
        if (fast) {
            if (!translateStart) translateStart = d3.event.translate.slice();
            var a = d3.event.translate,
                b = translateStart;
            surface.style(transformProp,
                'translate3d(' + ~~(a[0] - b[0]) + 'px,' + ~~(a[1] - b[1]) + 'px, 0px)');
        } else {
            redraw();
            translateStart = null;
        }
    }

    function resetTransform() {
        if (!surface.style(transformProp)) return;
        translateStart = null;
        surface.style(transformProp, '');
        redraw();
    }

    function redraw() {
        if (!dragging) {
            dispatch.move(map);
            tilegroup.call(background);
        }
        if (map.zoom() > 16) {
            connection.loadTiles(projection);
            drawVector(dragging);
        } else {
            hideVector();
        }
        return map;
    }

    function dblclickEnable(_) {
        if (!arguments.length) return dblclickEnabled;
        dblclickEnabled = _;
        return map;
    }

    function pointLocation(p) {
        var translate = projection.translate(),
            scale = projection.scale();
        return [(p[0] - translate[0]) / scale, (p[1] - translate[1]) / scale];
    }

    function locationPoint(l) {
        var translate = projection.translate(),
            scale = projection.scale();
        return [l[0] * scale + translate[0], l[1] * scale + translate[1]];
    }

    function pxCenter() {
        return [dimensions[0] / 2, dimensions[0] / 2];
    }

    map.zoom = function(z) {
        if (!arguments.length) {
            return Math.max(Math.log(projection.scale()) / Math.log(2) - 7, 0);
        }

        // summary:	Redraw the map at a new zoom level.
        var scale = 256 * Math.pow(2, z - 1);
        var center = pxCenter();
        var l = pointLocation(center);
        projection.scale(scale);
        zoom.scale(projection.scale());

        var t = projection.translate();
        l = locationPoint(l);
        t[0] += center[0] - l[0];
        t[1] += center[1] - l[1];
        projection.translate(t);
        zoom.translate(projection.translate());

        redraw();
        return map;
    };

    map.zoomIn = function() { return map.zoom(Math.ceil(map.zoom() + 1)); };
    map.zoomOut = function() { return map.zoom(Math.floor(map.zoom() - 1)); };

    map.center = function(loc) {
        if (!arguments.length) {
            return projection.invert(pxCenter());
        } else {
            var t = projection.translate(),
                c = pxCenter(),
                ll = projection(loc);
            projection.translate([
                t[0] - ll[0] + c[0], t[1] - ll[1] + c[1]]);
            zoom.translate(projection.translate());
            redraw();
            return map;
        }
    };

    map.extent = function() {
        return [projection.invert([0, 0]), projection.invert(dimensions)];
    };

    map.flush = function () {
        connection.flush();
        return map;
    };

    map.connection = function(_) {
        if (!arguments.length) return connection;
        connection = _;
        connection.on('load', connectionLoad);
        return map;
    };

    map.history = function (_) {
        if (!arguments.length) return history;
        history = _;
        history.on('change.map', redraw);
        return map;
    };

    map.background = background;
    map.projection = projection;
    map.selectEntity = selectEntity;
    map.dblclickEnable = dblclickEnable;

    return d3.rebind(map, dispatch, 'on', 'move');
};
