import React from "react";
import "./styles.css";
import initSqlJs from "sql.js";
import * as d3Fetch from "d3-fetch";
import queryString from "query-string";
import { Group } from "@vx/group";
import { Grid } from "@vx/grid";
import { AxisLeft, AxisBottom } from "@vx/axis";
import { LinePath, Line, Bar } from "@vx/shape";
import { curveMonotoneX } from "@vx/curve";
import { scaleTime, scaleLinear, scaleBand, scaleLog } from "@vx/scale";
import { ParentSize } from "@vx/responsive";

import { extent, max, min } from "d3-array";
import * as d3Time from "d3-time-format";
import * as d3Format from "d3-format";

export default class App extends React.Component {
  constructor() {
    super();
    this.state = {
      loading: true,
      db: null,
      err: null,
      results: null,
      states: [],
      counties: [],
      stateValue: "USA (all states)",
      countyValue: null,
      dates: [],
      dateAfter: "all",
      dateBefore: "all",
      scale: "linear",
    };
  }

  componentDidMount() {
    // sql.js needs to fetch its wasm file, so we cannot immediately instantiate the database
    // without any configuration, initSqlJs will fetch the wasm files directly from the same path as the js
    // see ../config-overrides.js

    initSqlJs()
      .then((SQL) => {
        this.setState({ db: new SQL.Database() }, () => {
          this.syncData();
        });
      })
      .catch((err) => this.setState({ err }));
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
      .then((data) => {
        let chunk = 100;
        for (let i = 0, j = data.length; i < j; i += chunk) {
          let values = data
            .slice(i, i + chunk)
            .map(
              (d) =>
                `("${d.date}","${d.county}","${d.state}",${d.fips || 0},${
                  d.cases
                },${d.deaths})`
            );

          let strValues = values.join(",\n");
          let q = `INSERT INTO covid_counties (date, county, state, fips, cases, deaths)\nVALUES\n${strValues};`;
          this.exec(q);
        }

        let results = this.state.db.exec(
          "SELECT DISTINCT state FROM covid_counties ORDER BY state"
        );
        let states = results[0].values;
        results = this.state.db.exec(
          "SELECT DISTINCT date FROM covid_counties ORDER BY date"
        );
        let dates = results[0].values;
        const p = queryString.parse(window.location.search);
        console.log(p["json"]);
        let parsed = p["json"] ? JSON.parse(p["json"]) : {};
        let counties = [];
        let stateValue = parsed["state"] || "USA (all states)";
        if (stateValue !== "USA (all states)") {
          counties = this.getCounties(stateValue);
        }
        this.setState(
          {
            loading: false,
            states,
            dates,
            stateValue: parsed["state"] || "USA (all states)",
            countyValue: parsed["county"] || null,
            dateAfter: parsed["after"] || "all",
            dateBefore: parsed["before"] || "all",
            scale: parsed["scale"] || "linear",
            counties,
          },
          () => {
            this.qFromSelects();
          }
        );
        // const parsed = queryString.parse(window.location.search);
        // if (parsed["q"]) {
        //   this.exec(parsed["q"]);
        // } else {

        // }
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

  getCounties(state) {
    let results = this.state.db.exec(
      `SELECT DISTINCT county FROM covid_counties WHERE state="${state}" ORDER BY county`
    );
    return results[0].values;
  }

  handleStateChange(event) {
    let counties = [];
    let value = event.target.value;
    if (value !== "USA (all states)") {
      counties = this.getCounties(value);
    }
    this.setState(
      {
        stateValue: event.target.value,
        counties,
        countyValue: "All (entire state)",
      },
      () => {
        this.qFromSelects();
      }
    );
  }

  handleCountyChange(event) {
    let value = event.target.value;
    this.setState({ countyValue: event.target.value }, () => {
      this.qFromSelects();
    });
  }

  handleDateAfterChange(event) {
    this.setState({ dateAfter: event.target.value }, () => {
      this.qFromSelects();
    });
  }

  handleDateBeforeChange(event) {
    this.setState({ dateBefore: event.target.value }, () => {
      this.qFromSelects();
    });
  }

  handleScaleChange(event) {
    this.setState({ scale: event.target.value }, () => {
      this.qFromSelects();
    });
  }

  qFromSelects() {
    let whereClauses = [];
    if (this.state.stateValue !== "USA (all states)") {
      whereClauses.push(`state="${this.state.stateValue}" `);
      if (this.state.countyValue !== "All (entire state)") {
        whereClauses.push(`county="${this.state.countyValue}"`);
      }
    }
    if (this.state.dateAfter !== "all") {
      whereClauses.push(`date >= "${this.state.dateAfter}"`);
    }
    if (this.state.dateBefore !== "all") {
      whereClauses.push(`date <= "${this.state.dateBefore}"`);
    }
    let whereClause =
      whereClauses.length > 0 && `WHERE ${whereClauses.join(" AND ")}`;
    let q = `SELECT date, SUM(cases) AS cases, SUM(deaths) AS deaths FROM covid_counties ${whereClause} GROUP BY (date)`;
    this.exec(q);

    let enc = encodeURIComponent;
    let json = JSON.stringify({
      state: this.state.stateValue,
      county: this.state.countyValue,
      after: this.state.dateAfter,
      before: this.state.dateBefore,
      scale: this.state.scale,
    });
    window.history.replaceState(null, "", `?json=${enc(json)}`);
  }

  graphSelector() {
    return (
      <div class="selectors">
        <label for="state">State</label>
        <select
          name="state"
          value={this.state.stateValue}
          onChange={(e) => this.handleStateChange(e)}
        >
          <option value="USA (all states)">USA (all states)</option>
          {this.state.states.map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
        <label for="county">County</label>
        <select
          name="county"
          value={this.state.countyValue}
          onChange={(e) => this.handleCountyChange(e)}
        >
          {this.state.stateValue !== "USA (all states)" && (
            <option value="All (entire state)">All (entire state)</option>
          )}
          {this.state.counties.map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
        <label for="daterange">Date range</label>
        <select
          name="daterange"
          value={this.state.dateAfter}
          onChange={(e) => this.handleDateAfterChange(e)}
        >
          <option value="all"> -- beginning date -- </option>
          {this.state.dates.map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
        <select
          value={this.state.dateBefore}
          onChange={(e) => this.handleDateBeforeChange(e)}
        >
          <option value="all"> -- end date -- </option>
          {this.state.dates.map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
      </div>
    );
  }

  graphData({ columns, values }, width, height) {
    const xIndex = columns.indexOf("date");
    const yIndex = columns.indexOf("cases");
    const yDeathsIndex = columns.indexOf("deaths");

    // responsive utils for axis ticks
    function numTicksForHeight(height) {
      // if (height <= 300) return 3;
      // if (300 < height && height <= 600) return 5;
      // return 10;

      return 2;
    }

    function numTicksForWidth(width) {
      if (width <= 300) return 2;
      if (300 < width && width <= 400) return 5;
      return 10;
    }

    const parseDate = d3Time.timeParse("%Y-%m-%d");
    const x = (d) => parseDate(d[xIndex]);
    const y = (d) => +d[yIndex];
    const yDeaths = (d) => +d[yDeathsIndex];

    // bounds
    const margin = 60;
    const xMax = width - margin - margin;
    const yMax = height - margin - margin;
    // scales
    const xScale = scaleTime({
      range: [0, xMax],
      domain: extent(values, x),
    });
    const xDeathsScale = scaleBand({
      range: [0, xMax],
      domain: values.map(x),
    });
    const yScale =
      this.state.scale === "linear"
        ? scaleLinear({
            range: [yMax, 0],
            domain: [0, max(values, y)],
          })
        : scaleLog({
            range: [yMax, 0],
            domain: extent(values, y),
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
          numTicksRows={4}
          numTicksColumns={numTicksForWidth(width)}
        />
        <Group top={margin} left={margin} key="deaths">
          {values.map((d, i) => {
            const date = x(d);
            const barWidth = xDeathsScale.bandwidth();
            const barHeight = yMax - yScale(yDeaths(d));
            const barX = xDeathsScale(date);
            const barY = yMax - barHeight;
            return (
              <Bar
                key={`bar-${i}`}
                x={barX}
                y={barY}
                width={barWidth}
                height={barHeight}
                fill="rgba(23, 233, 217, .5)"
              />
            );
          })}
        </Group>
        <Group key={`lines-1`} top={margin} left={margin}>
          <LinePath
            data={values}
            x={(d) => xScale(x(d))}
            y={(d) => yScale(y(d))}
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
            numTicks={4}
            label="Cases"
            tickFormat={d3Format.format("~s")}
            labelProps={{
              fill: "#FFF",
              textAnchor: "middle",
              fontSize: 12,
              fontFamily: "Arial",
            }}
            stroke="#FFF"
            tickStroke="#FFF"
            tickLabelProps={(value, index) => ({
              fill: "#FFF",
              textAnchor: "end",
              fontSize: 10,
              fontFamily: "Arial",
              dx: "-0.25em",
              dy: "0.25em",
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
            {(axis) => {
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
                    fill="#FFF"
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
              {columns.map((columnName) => (
                <td>{columnName}</td>
              ))}
            </tr>
          </thead>

          <tbody>
            {values.map((
              row // values is an array of arrays representing the results of the query
            ) => (
              <tr>
                {row.map((value) => (
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
        {/* <textarea
          rows={3}
          defaultValue={parsed["q"]}
          onChange={e => this.inputDebounce(e.target.value, true)}
          placeholder="Enter some SQL. Try “SELECT * FROM covid_counties;”"
        ></textarea> */}
        <pre className="error">{(err || "").toString()}</pre>
        {this.graphSelector()}
        {results && (
          <ParentSize className="graph-container">
            {({ width: w, height: h }) => {
              return results.map((d) => this.graphData(d, w, 500));
            }}
          </ParentSize>
        )}
        <label for="scale">Scale</label>
        <select
          name="scale"
          value={this.state.scale}
          onChange={(e) => this.handleScaleChange(e)}
        >
          <option value="linear">linear</option>
          <option value="log">log</option>
        </select>

        {/* <pre>
          {results
            ? results.map(this.renderResult) // results contains one object per select statement in the query
            : ""}
        </pre> */}
      </div>
    );
  }
}
