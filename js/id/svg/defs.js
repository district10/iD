/*
    A standalone SVG element that contains only a `defs` sub-element. To be
    used once globally, since defs IDs must be unique within a document.
*/
iD.svg.Defs = function(context) {
    function autosize(image) {
        var img = document.createElement('img');
        img.src = image.attr('xlink:href');
        img.onload = function() {
            image.attr({
                width: img.width,
                height: img.height
            });
        };
    }

    function SVGSpriteDefinition(id, href) {
        return function(defs) {
            d3.xml(href, 'image/svg+xml', function(err, svg) {
                if (err) return;
                defs.node().appendChild(
                    d3.select(svg.documentElement).attr('id', id).node()
                );
            });
        };
    }

    function ImageSpriteDefinition(id, href, data) {
        return function(defs) {
            defs.append('image')
                .attr('id', id)
                .attr('xlink:href', href)
                .call(autosize);

            defs.selectAll()
                .data(data)
                .enter().append('use')
                .attr('id', function(d) { return d.key; })
                .attr('transform', function(d) { return 'translate(-' + d.value[0] + ',-' + d.value[1] + ')'; })
                .attr('xlink:href', '#' + id);
        };
    }

    return function (selection) {
        var defs = selection.append('defs');

        // marker
        defs.append('marker')
            .attr({
                id: 'oneway-marker',
                viewBox: '0 0 10 10',
                refY: 2.5,
                refX: 5,
                markerWidth: 2,
                markerHeight: 2,
                orient: 'auto'
            })
            .append('path')
            .attr('d', 'M 5 3 L 0 3 L 0 2 L 5 2 L 5 0 L 10 2.5 L 5 5 z');

        // patterns
        var patterns = defs.selectAll('pattern')
            .data([
                // pattern name, pattern image name
                ['wetland', 'wetland'],
                ['construction', 'construction'],
                ['cemetery', 'cemetery'],
                ['orchard', 'orchard'],
                ['farmland', 'farmland'],
                ['beach', 'dots'],
                ['scrub', 'dots'],
                ['meadow', 'dots']
            ])
            .enter()
            .append('pattern')
            .attr({
                id: function (d) {
                    return 'pattern-' + d[0];
                },
                width: 32,
                height: 32,
                patternUnits: 'userSpaceOnUse'
            });

        patterns.append('rect')
            .attr({
                x: 0,
                y: 0,
                width: 32,
                height: 32,
                'class': function (d) {
                    return 'pattern-color-' + d[0];
                }
            });

        patterns.append('image')
            .attr({
                x: 0,
                y: 0,
                width: 32,
                height: 32
            })
            .attr('xlink:href', function (d) {
                return context.imagePath('pattern/' + d[1] + '.png');
            });

        // clip paths
        defs.selectAll()
            .data([12, 18, 20, 32, 45])
            .enter().append('clipPath')
            .attr('id', function (d) {
                return 'clip-square-' + d;
            })
            .append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', function (d) {
                return d;
            })
            .attr('height', function (d) {
                return d;
            });

        // maki
        var maki = [];
        _.forEach(iD.data.featureIcons, function (dimensions, name) {
            if (dimensions['12'] && dimensions['18'] && dimensions['24']) {
                maki.push({key: 'maki-' + name + '-12', value: dimensions['12']});
                maki.push({key: 'maki-' + name + '-18', value: dimensions['18']});
                maki.push({key: 'maki-' + name + '-24', value: dimensions['24']});
            }
        });

        defs.call(SVGSpriteDefinition(
            'iD-sprite',
            context.imagePath('iD-sprite.svg')));

        defs.call(ImageSpriteDefinition(
            'maki-sprite',
            context.imagePath('maki-sprite.png'),
            maki));
    };
};
