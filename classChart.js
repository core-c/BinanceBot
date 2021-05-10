
// the Highcharts/stockchart
class ChartClass {
    constructor(theClassBinanceManager, containerId) {
        this.containerId = containerId;
        this.containerObj = $('#' + containerId);
        this.chart = undefined;		// the chart instance
        this.mgr = theClassBinanceManager;
        // the stream assigned to the chart
        this.assignedStream = {
            symbol: undefined,		    // string
            interval: undefined		    // string
        }
        // the data
        this.dataOHLC = [];			    // [[time,open,high,low,close]...]
        this.dataVolume = [];		    // [[time,volume]...]
        // create the chart
        this.create();                  // initially, with no data..
    }

    // assign a stream for displaying
    assignStream(theSymbol, theInterval) {
        this.assignedStream.symbol = '';
        this.assignedStream.interval = '';
        var i = this.mgr.streamFind(theSymbol, theInterval); // the index of the stream..
        if (i == -1) return false;
        this.assignedStream.symbol = theSymbol;
        this.assignedStream.interval = theInterval;
        // copy the symbol data (TOHLCV) to this class into seperate series arrays (TOHLC & TV)
        this.setData(this.mgr.streams[i].ref.data);
        // re-create the chart
        this.create();
        return true;
    }

    // store the supplied data in the class, and split up into seperate data series.
    // The argument TOHLCV is of the format: [[time,open,high,low,close,volume]...]
    setData(TOHLCV) {
        if (this.chart == undefined) return;
        if (TOHLCV == undefined) return;
        if (TOHLCV.length == 0) return;
        // A multi-dimensional array needs to get copied by value, so we slice & splice
        this.dataOHLC = [];		// [[time,open,high,low,close]...]
        this.dataVolume = [];	// [[time,volume]...]
        for (var i = 0; i < TOHLCV.length ; i++) {
            // copy by value: slice
            this.dataOHLC[i] = TOHLCV[i].slice();
            this.dataVolume[i] = TOHLCV[i].slice();
            // remove elements: splice
            this.dataOHLC[i].splice(5, 1);		// remove element[5]: volume
            this.dataVolume[i].splice(1, 4);	// remove elements[1..4]: O,H,L,C
        }
        this.chart.series[0].setData(this.dataOHLC);
        this.chart.series[1].setData(this.dataVolume);
    }

    addCandle(candle) {
        var lastOHLC = [], lastVolume = [];
        var lastCandleVisible = true;
        var series0, series1;

        // this candle has just been received
        lastOHLC = [candle.k.t, +candle.k.o, +candle.k.h, +candle.k.l, +candle.k.c]; // the + will convert it to a number..
        lastVolume = [candle.k.t, +candle.k.v];

        // In any case, store the candle locally, if it is now closed
        if (candle.k.x) {
            this.dataOHLC.push(lastOHLC);
            this.dataVolume.push(lastVolume);
        }

        if (this.chart == undefined) return false;
        series0 = this.chart.series[0];
        series1 = this.chart.series[1];
        lastCandleVisible = (series0.data.length > 0) ? series0.xAxis.max == series0.data[series0.data.length - 1].x : true;
//$("body").css("background", lastCandleVisible ? "#FFFFFF" : "#FF0000"); //debug test..
        // check if the last candle is visible in the chart.
        if (lastCandleVisible) {
            if (series0.data.length > 0) {
                // the last/current candle will get updated, meaning:
                // We remove it, and recreate it with the latest data.
                series0.removePoint(series0.data.length - 1, false); // no redraw
                series1.removePoint(series1.data.length - 1, false);
                // check if we need to add candles that were invisble (because when selected range was out of view)
                if (this.dataOHLC.length - series0.data.length > 0) {
                    series0.setData(this.dataOHLC);
                    series1.setData(this.dataVolume);
                }
            }
            // add a new last point..
            series0.addPoint(lastOHLC, false);
            series1.addPoint(lastVolume, true); // redraw
            // update indicators, but not at every tick..
            if (candle.k.x) {
                series0.update();
                series1.update();
            }
        }
        return true;
    }

    // create a new chart, using the locally stored data
    create() {
        // destroy any existing chart, and create a new one: the safest way.
        if (this.chart != undefined) this.chart.destroy();
        {
            var theSymbol = this.assignedStream.symbol;
            var theInterval = this.assignedStream.interval;

            // show dates in user local time
            Highcharts.setOptions({
                global: {
                    useUTC: false
                }
            });

            // custom indicator: Know Sure Thing
            (function (H) {
                var SMA = H.seriesTypes.sma;
                var kstData = [];

                Highcharts.seriesType(
                    'kst',
                    'sma', {
                        name: 'Know Sure Thing',
                        params: {
                            //period: 9,
                            rocPeriod1: 10,
                            rocPeriod2: 15,
                            rocPeriod3: 20,
                            rocPeriod4: 30,
                            smaPeriod1: 10,
                            smaPeriod2: 10,
                            smaPeriod3: 10,
                            smaPeriod4: 15,
                            signalPeriod: 9
                        },
                        kstLine: {
                            styles: {
                                lineWidth: 1,
                                lineColor: undefined,
                                crossLineColor: undefined
                            }
                        },
                        signalLine: {
                            styles: {
                                lineWidth: 1,
                                signalLineColor: undefined,
                                crossLineColor: undefined
                            }
                        },
                        marker: {
                            enabled: false
                        },
                        tooltip: {
                            pointFormat: '<span style="color:{point.color}">\u25CF</span><b> {series.name}</b><br/>kst: {point.kst}<br/>signal: {point.signal}<br/>'
                        }
                    },
                    {
                        //=== internal vars, not published in the API
                        pointArrayMap: ['kst', 'signal'],
                        pointValKey: 'kst',

                        //=== helper functions:
                        getKstData: function (time) {
                            for (var i = 0; i < kstData.length; i++) {
                                if (kstData[i].time != time) continue;
                                return kstData[i];
                            }
                            return null;
                        },

                        //=== seriesType events:
                        init: function () {
                            SMA.prototype.init.apply(this, arguments);
                            this.options = H.merge({
                                kstLine: {
                                    styles: {
                                        lineColor: this.color,
                                        signalLineColor: this.color,
                                        crossLineColor: this.color
                                    }
                                },
                                signalLine: {
                                    styles: {
                                        lineColor: this.color,
                                        signalLineColor: this.color,
                                        crossLineColor: this.color
                                    }
                                }
                            }, this.options);
                            // backup some code.. 
                            //cl.path.safeRemoveChild(cl.path.element); // remove path
                            //cl.path.attr({ // edit path
                            //    d: 'M ' + r.x + ' ' + r.y + ' L ' + r.x + ' ' + ((k.isCrossover) ? r.top : r.bottom)
                            //});
                            // clip the SVG path to the chart pane boundries.
                            // otherwise the lines will draw outside the chart.
                            //var c = indicator.chart;
                            //var clipper = c.renderer.clipRect(c.plotLeft, c.plotTop, c.plotWidth, c.plotHeight);
                            //cl.path.clip(clipper);
                        },

                        toYData: function (point) {
                            return [point.kst, point.signal];
                        },
/*
                        // We don't really need the render event..
                        render: function () {
                            var indicator = this;
                            SMA.prototype.render.apply(this, arguments);
                        },
*/
                        getGraphPath: function (points) {
                            var indicator = this;
                            var path = [];
                            path = SMA.prototype.getGraphPath.call(indicator, points); //path = SMA.prototype.getGraphPath.apply(indicator, arguments);
                            // Draw lines to the 0 baseline, and the crossover/crossunder lines
                            // Decorate the signalline:
                            if (!indicator.isKST) {
                                if (isArray(points)) {
                                    var zero = indicator.yAxis.toPixels(0, true);
                                    var min = indicator.yAxis.toPixels(indicator.yAxis.min, true);
                                    var max = indicator.yAxis.toPixels(indicator.yAxis.max, true);
                                    var pathxtra = [];
                                    for (var i = 0; i < points.length; i++) {
                                        var p = points[i];
                                        pathxtra.push(['M', p.plotX, p.plotY, 'L', p.plotX, zero]);
                                        if (p.isCrossover) pathxtra.push(['M', p.plotX, p.plotY, 'L', p.plotX, max]);
                                        if (p.isCrossunder) pathxtra.push(['M', p.plotX, p.plotY, 'L', p.plotX, min]);
                                    }
                                    path = path.concat(pathxtra);
                                }
                            }
                            return path;
                        },

                        drawGraph: function () {
                            var indicator = this;
                            var mainLineOptions = indicator.options;
                            var mainLinePoints = indicator.points;
                            var mainLinePath = indicator.graph;
                            var pointsLength = mainLinePoints.length;
                            var pointArrayMapLength = indicator.pointArrayMap.length;
                            var allPoints = [[], []];
                            var position;

                            // prepare all points of all lines
                            while (pointsLength--) {
                                var point = mainLinePoints[pointsLength]; // point is an array [point.kst, point.smakst]
                                for (var i = 0; i < pointArrayMapLength; i++) {
                                    position = indicator.pointArrayMap[i];
                                    if (H.defined(point[position])) {
                                        // find the crossovers/crossunders from the kstData
                                        var data = this.getKstData(point.x);
                                        //
                                        allPoints[i].push({
                                            plotX: point.plotX,
                                            plotY: indicator.yAxis.toPixels(point[position], true),
                                            isNull: false,
                                            // add crossings info for getGraphPath
                                            isCrossover: (data) ? data.isCrossover : false,
                                            isCrossunder: (data) ? data.isCrossunder : false
                                        });
                                    }
                                }
                            }

                            // draw the signalline
                            indicator.isKST = false; // used in getGraphPath
                            indicator.points = allPoints[1];
                            indicator.options = H.merge(mainLineOptions['signalLine'].styles);
                            indicator.graph = indicator['graph' + 'signalLine'];
                            indicator.color = indicator.options.signalLineColor;
                            SMA.prototype.drawGraph.call(indicator);
                            indicator['graph' + 'signalLine'] = indicator.graph;

                            // draw the kst line
                            indicator.isKST = true; // used in getGraphPath
                            indicator.points = allPoints[0];//mainLinePoints;
                            indicator.options = mainLineOptions;
                            indicator.color = indicator.options.lineColor;
                            indicator.graph = mainLinePath;
                            SMA.prototype.drawGraph.call(indicator);

                            indicator.points = mainLinePoints; // restore the original points
                            delete indicator.isKST;
                            allPoints = null;
                        },

                        getValues: function (series, params) {
                            var yPoints = [], points = [];
                            kstData = kst(series.xData, series.yData, params.rocPeriod1, params.rocPeriod2, params.rocPeriod3, params.rocPeriod4, params.smaPeriod1, params.smaPeriod2, params.smaPeriod3, params.smaPeriod4, params.signalPeriod); // need timestamps too..
                            for (var i = 0; i < series.xData.length; i++) {
                                points.push([series.xData[i], kstData[i].kst, kstData[i].signal]);
                                yPoints.push([kstData[i].kst, kstData[i].signal]);
                            }
                            return {
                                xData: series.xData.slice(), // array of x-values (make a copy!)
                                yData: yPoints, // array of y-values
                                values: points, // array of points
                            };
                        }
                    }
                );
            }(Highcharts));

            // set all the options..
            var chartOptions = {
/*
                rangeSelector: {
                    selected: 2
                },
*/
                title: {
                    text: theSymbol + " " + theInterval
                },

                credits: {
                    href: "https://fastfrank.nl/",
                    position: {
                        x: -50
                    },
                    text: "©FF v0.5.2"
                },

                legend: {
                    enabled: true
                },

                plotOptions: {
                    candlestick: {
                        shadow: {
                            color: "#CCCCCC",
                            width: 8
                        },
                        grouping: false
                    },
                    column: {
                        borderRadius: 2
                    },
                    series: {
                        showInLegend: true,
                        cropThreshold: 500,
                        "dataGrouping": {
                            "enabled": false
                        }
                    }
                },

                stockTools: {
                    gui: {
                        buttons: ['indicators', 'separator', 'simpleShapes', 'lines', 'crookedLines', 'measure', 'advanced', 'toggleAnnotations', 'separator', 'verticalLabels', 'flags']
                    }
                },

                chart: {
                    marginRight: 120, // give the current price indicator some space..
                    spacingLeft: 100,
                    spacingRight: 20,
                    zoomType: 'x' // select a range by dragging the mouse
                },
/*
                xAxis: {
                    events: {
                        afterSetExtremes: function (event) {
//                            this.chart.series[0].setData(this.dataOHLC);
//                            this.chart.series[1].setData(this.dataVolume);
//                            this.openCandle = false; // all candles are now closed

                            //var points = event.target.series[0].points;
                            //var maxPoint = points[points.length - 1];
                            //if (maxPoint.x == event.target.series[0].data[event.target.series[0].data.length - 1].x)
                            //alert("woot");
                        }
                    }
                },
*/
                // static position for tooltips (easier to read, less cluttering around the selected point)
                tooltip: {
                    shape: 'square',
                    headerShape: 'callout',
                    borderWidth: 0,
                    shadow: true,
                    positioner: function (width, height, point) { // return a 2D position
                        if (point.isHeader) {
                            return {
                                x: Math.max(this.chart.plotLeft, Math.min(
                                    point.plotX + this.chart.plotLeft - width / 2,
                                    this.chart.chartWidth - width - this.chart.marginRight
                                )),
                                y: point.plotY
                            };
                        } else {
                            return {
                                x: point.series.chart.plotLeft - 100,
                                y: point.series.yAxis.top - this.chart.plotTop
                            };
                        }
                    },
/*
                    formatter: function () {
                        var s = '<b>' + theSymbol +'</b><br>';
                        s += 'Open: ' + this.points[0].open + '<br>';
                        s += 'High: ' + this.points[0].y[2] + '<br>';
                        s += 'Low: ' + this.points[0].y + '<br>';
                        s += 'Close: ' + this.points[0].y;
                        return s;
                    }
*/
                },

                responsive: {
                    rules: [{
                        condition: {
                            maxWidth: 800
                        },
                        chartOptions: {
                            rangeSelector: {
                                inputEnabled: false
                            }
                        }
                    }]
                },

                yAxis: [{ // ohlc
                    labels: {
                        align: 'left'
                    },
                    height: '60%',
                    resize: {
                        enabled: true
                    }
                }, { // volumes
                    labels: {
                        align: 'left'
                    },
                    resize: {
                        enabled: true
                    },
                    height: '20%',
                    top: '60%',
                    offset: 10
                }, { // Know Sure Thing
                    labels: {
                        align: 'left'
                    },
                    height: '20%',
                    top: '80%',
                    //ceiling: 100,
                    //floor: -100,
                    offset: 8
                }],

                series: [{
                    id: "seriesOHLC", // we need an id for the indicators
                    type: 'candlestick',
                    name: theSymbol,
                    color: '#2f7ed8',
                    //lineColor: '#2f7ed8',
                    //upLineColor: 'silver',
                    upColor: 'silver',
                    lastVisiblePrice: { // the current price indicators
                        enabled: true,
                        label: {
                            enabled: true
                        },
                        color: 'red'
                    },
                    zIndex: 100,
                    data: this.dataOHLC
                }, {
                    id: "seriesVolume",
                    type: 'column',
                    name: 'Volume',
                    color: '#2f5ea8',
                    yAxis: 1,
                    data: this.dataVolume
                }, {
                    type: 'bb', // Bollinger Bands
                    linkedTo: 'seriesOHLC',
                    color: "#CCCCFF", // just the lines-color, not the fill area
                    params: {
                        period: 20,
                        standardDeviation: 2
                    }

                }, {
                    type: 'kst', // Know Sure Thing
                    linkedTo: 'seriesOHLC',
                    lineColor: "#AA4444",
                    signalLineColor: "#4444AA",
                    crossLineColor: "#AAAAAA",
                    yAxis: 2,
                    params: {
                        rocPeriod1: 10,
                        rocPeriod2: 15,
                        rocPeriod3: 20,
                        rocPeriod4: 30,
                        smaPeriod1: 10,
                        smaPeriod2: 10,
                        smaPeriod3: 10,
                        smaPeriod4: 15,
                        signalPeriod: 9
                    }
                }]
                /*			,
                            navigator: {
                                series: {
                                    type: 'column',
                                },
                                data: [{
                                    data: dataVolume
                                }]
                            }
                */
            };

            // ..this will actually create the chart
            this.chart = Highcharts.stockChart(this.containerId, chartOptions);
            //this.chart = this.containerObj.highcharts('StockChart', chartOptions); // JQuery way.. but this.chart undefined
        }
    }
}
