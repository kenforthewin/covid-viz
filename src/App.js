import React from "react";
import "./styles.css";
import initSqlJs from "sql.js";
import * as d3 from "d3-fetch";
import queryString from "query-string";
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

    d3.csv(
      "https://raw.githubusercontent.com/nytimes/covid-19-data/master/us-counties.csv"
    ).then(data => {
      let chunk = 100;
      // data.forEach(d => {
      //   let strValues = `("${d.date}","${d.county}","${d.state}",${d.fips},${d.cases},${d.deaths})`;
      //   let q = `INSERT INTO covid_counties (date, county, state, fips, cases, deaths)\nVALUES\n${strValues};`;
      //   this.exec(q);
      // });
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
        console.log(q);
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

  /**
   * Renders a single value of the array returned by db.exec(...) as a table
   */
  renderResult({ columns, values }) {
    return (
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
    );
  }

  render() {
    let { db, err, results, loading } = this.state;
    const parsed = queryString.parse(window.location.search);
    if (loading) return <pre>Loading...</pre>;
    return (
      <div className="App">
        <h1>Covid SQL</h1>

        <textarea
          defaultValue={parsed["q"]}
          onChange={e => this.inputDebounce(e.target.value, true)}
          placeholder="Enter some SQL. Try “SELECT * FROM covid_counties;”"
        ></textarea>

        <pre className="error">{(err || "").toString()}</pre>

        <pre>
          {results
            ? results.map(this.renderResult) // results contains one object per select statement in the query
            : ""}
        </pre>
      </div>
    );
  }
}
