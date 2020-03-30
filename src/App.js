import React from "react";
import "./styles.css";
import initSqlJs from "sql.js";
import * as d3Fetch from "d3-fetch";
import queryString from "query-string";
import { Group } from "@vx/group";
import { Grid } from "@vx/grid";
import { AxisLeft, AxisBottom } from "@vx/axis";
import { LinePath, Line } from "@vx/shape";
import { curveMonotoneX } from "@vx/curve";
import { scaleTime, scaleLinear } from "@vx/scale";
import { ParentSize } from "@vx/responsive";

import { extent, max, min } from "d3-array";
import * as d3Time from "d3-time-format";

export default class App extends React.Component {
  constructor() {
    super();
    this.state = { loading: true, db: null, err: null, results: null };
  }

  componentDidMount() {
    // sql.js needs to fetch its wasm file, so we cannot immediately instantiate the database
    // without any configuration, initSqlJs will fetch the wasm files directly from the same path as the js
    // see ../config-overrides.js

    initSqlJs()
      .then(SQL => {
        this.setState({ db: new SQL.Database() }, () => {
          this.syncData();
        });
      })
      .catch(err => this.setState({ err }));
  }

  syncData() {
    this.exec("DROP TABLE IF EXISTS covid_counties;");
    this.exec(
      "CREATE TABLE covid_counties (date TEXT, county TEXT, state TEXT, fips INTEGER, cases INTEGER, deaths INTEGER);"
    );

    d3Fetch
      .csv(
        "https://raw.githubusercontent.com/nytimes/covid-19-data/master/us-counties.csv"
      )
      .then(data => {
        let chunk = 100;
        for (let i = 0, j = data.length; i < j; i += chunk) {
          let values = data
            .slice(i, i + chunk)
            .map(
              d =>
                `("${d.date}","${d.county}","${d.state}",${d.fips || 0},${
                  d.cases
                },${d.deaths})`
            );

          let strValues = values.join(",\n");
          let q = `INSERT INTO covid_counties (date, county, state, fips, cases, deaths)\nVALUES\n${strValues};`;
          this.exec(q);
        }
        this.setState({ loading: false });
        const parsed = queryString.parse(window.location.search);
        if (parsed["q"]) {
          this.exec(parsed["q"]);
        }
      });
  }

  inputDebounce(sql, setUrl = false) {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.exec(sql, setUrl);
    }, 500);
  }

  exec(sql, setUrl = false) {
    let results = null,
      err = null;
    try {
      // The sql is executed synchronously on the UI thread.
      // You may want to use a web worker
      results = this.state.db.exec(sql); // an array of objects is returned
    } catch (e) {
      // exec throws an error when the SQL statement is invalid
      err = e;
    }
    this.setState({ results, err }, () => {
      if (setUrl) {
        let q = encodeURIComponent(sql);
        window.history.replaceState(null, "", `?q=${q}`);
      }
    });
  }

  graphData({ columns, values }, width, height) {
    if (values.length > 10000) {
      return null;
    }
    // console.log(values);
    const xIndex = columns.indexOf("date");
    if (xIndex === -1) {
      return <div>Add a `date` and `cases` column to graph the results.</div>;
    }
    const yIndex = columns.indexOf("cases");
    if (yIndex === -1) {
      return <div>Add a `date` and `cases` column to graph the results.</div>;
    }

    // responsive utils for axis ticks
    function numTicksForHeight(height) {
      if (height <= 300) return 3;
      if (300 < height && height <= 600) return 5;
      return 10;
    }

    function numTicksForWidth(width) {
      if (width <= 300) return 2;
      if (300 < width && width <= 400) return 5;
      return 10;
    }

    const parseDate = d3Time.timeParse("%Y-%m-%d");
    const x = d => parseDate(d[xIndex]);
    const y = d => d[yIndex];
    // bounds
    const margin = 60;
    const xMax = width - margin - margin;
    const yMax = height - margin - margin;
    // scales
    console.log(extent(values, x));
    const xScale = scaleTime({
      range: [0, xMax],
      domain: extent(values, x)
    });
    const yScale = scaleLinear({
      range: [yMax, 0],
      domain: [0, max(values, y)]
    });
    return (
      <svg width={width} height={height}>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="#242424"
          rx={14}
        />
        <Grid
          top={margin}
          left={margin}
          xScale={xScale}
          yScale={yScale}
          stroke="rgb(102, 102, 102)"
          width={xMax}
          height={yMax}
          numTicksRows={numTicksForHeight(height)}
          numTicksColumns={numTicksForWidth(width)}
        />
        <Group key={`lines-1`} top={margin} left={margin}>
          <LinePath
            data={values}
            x={d => xScale(x(d))}
            y={d => yScale(y(d))}
            stroke={"#ffffff"}
            strokeWidth={2}
            curve={curveMonotoneX}
          />
        </Group>
        <Group left={margin}>
          <AxisLeft
            top={margin}
            left={0}
            scale={yScale}
            hideZero
            numTicks={numTicksForHeight(height)}
            label="Cases"
            labelProps={{
              fill: "#FFF",
              textAnchor: "middle",
              fontSize: 12,
              fontFamily: "Arial"
            }}
            stroke="#FFF"
            tickStroke="#FFF"
            tickLabelProps={(value, index) => ({
              fill: "#FFF",
              textAnchor: "end",
              fontSize: 10,
              fontFamily: "Arial",
              dx: "-0.25em",
              dy: "0.25em"
            })}
            tickComponent={({ formattedValue, ...tickProps }) => (
              <text {...tickProps}>{formattedValue}</text>
            )}
          />
          <AxisBottom
            top={height - margin}
            left={0}
            scale={xScale}
            numTicks={numTicksForWidth(width)}
            label="Date"
          >
            {axis => {
              const tickLabelSize = 10;
              const tickRotate = 45;
              const tickColor = "#FFF";
              const axisCenter =
                (axis.axisToPoint.x - axis.axisFromPoint.x) / 2;
              return (
                <g className="my-custom-bottom-axis">
                  {axis.ticks.map((tick, i) => {
                    const tickX = tick.to.x;
                    const tickY = tick.to.y + tickLabelSize + axis.tickLength;
                    return (
                      <Group
                        key={`vx-tick-${tick.value}-${i}`}
                        className={"vx-axis-tick"}
                      >
                        <Line
                          from={tick.from}
                          to={tick.to}
                          stroke={tickColor}
                        />
                        <text
                          transform={`translate(${tickX}, ${tickY}) rotate(${tickRotate})`}
                          fontSize={tickLabelSize}
                          textAnchor="middle"
                          fill={tickColor}
                        >
                          {tick.formattedValue}
                        </text>
                      </Group>
                    );
                  })}
                  <text
                    textAnchor="middle"
                    transform={`translate(${axisCenter}, 50)`}
                    fontSize="8"
                  >
                    {axis.label}
                  </text>
                </g>
              );
            }}
          </AxisBottom>
        </Group>
      </svg>
    );
  }

  /**
   * Renders a single value of the array returned by db.exec(...) as a table
   */
  renderResult({ columns, values }) {
    let truncated = false;
    let length = values.length;
    if (values.length > 1000) {
      truncated = true;
      values = values.slice(0, 1000);
    }
    return (
      <div>
        {truncated && (
          <div>{`truncated: 1,000 of ${length} shown and graph skipped.`}</div>
        )}
        <table>
          <thead>
            <tr>
              {columns.map(columnName => (
                <td>{columnName}</td>
              ))}
            </tr>
          </thead>

          <tbody>
            {values.map((
              row // values is an array of arrays representing the results of the query
            ) => (
              <tr>
                {row.map(value => (
                  <td>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  render() {
    let { db, err, results, loading } = this.state;
    const parsed = queryString.parse(window.location.search);
    if (loading) return <pre>Loading...</pre>;
    return (
      <div className="App">
        <textarea
          rows={3}
          defaultValue={parsed["q"]}
          onChange={e => this.inputDebounce(e.target.value, true)}
          placeholder="Enter some SQL. Try “SELECT * FROM covid_counties;”"
        ></textarea>

        <pre className="error">{(err || "").toString()}</pre>
        {results && (
          <ParentSize className="graph-container">
            {({ width: w, height: h }) => {
              return results.map(d => this.graphData(d, w, 500));
            }}
          </ParentSize>
        )}

        <pre>
          {results
            ? results.map(this.renderResult) // results contains one object per select statement in the query
            : ""}
        </pre>
      </div>
    );
  }
}
