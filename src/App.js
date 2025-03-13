// App.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import * as d3 from 'd3';
import InteractiveDCAChart, { detectDateColumn } from './InteractiveDCAChart';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';

export default function App() {
  const [dataString, setDataString] = useState('');
  const [minDate, setMinDate] = useState(null);
  const [maxDate, setMaxDate] = useState(null);
  const [dateRange, setDateRange] = useState([0, 0]);
  const [showDataInput, setShowDataInput] = useState(false);
  const [showParameters, setShowParameters] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [show60DayAverages, setShow60DayAverages] = useState(false);
  const [colors, setColors] = useState({
    oil: "#008000",
    water: "#0000ff",
    gas: "#ff0000",
    pressure: "#000000"
  });
  const [yScaleType, setYScaleType] = useState("linear");
  const [forecastDays, setForecastDays] = useState(90);
  const [chartKey, setChartKey] = useState(0);
  const [chartParams, setChartParams] = useState(null);
  const [sixtyDayAverages, setSixtyDayAverages] = useState(null);
  const [sixtyDayJSON, setSixtyDayJSON] = useState("");

  // Parse CSV to get date range (only when dataString changes)
  useEffect(() => {
    if (!dataString) return;
    try {
      const parsed = d3.csvParse(dataString);
      if (parsed && parsed.length > 0 && parsed.columns) {
        const dateCol = detectDateColumn(parsed.columns);
        const dates = parsed.map(row => new Date(row[dateCol])).filter(d => !isNaN(d));
        if (dates.length) {
          const minD = new Date(Math.min(...dates));
          const maxD = new Date(Math.max(...dates));
          setMinDate(minD);
          setMaxDate(maxD);
          const totalDays = Math.ceil((maxD - minD) / 86400000);
          setDateRange([0, totalDays]);
        }
      }
    } catch (err) {
      console.error("Error parsing CSV:", err);
    }
  }, [dataString]);

  // File upload handler
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    const reader = new FileReader();
    if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
      reader.onload = ev => setDataString(ev.target.result);
      reader.readAsText(file);
    } else if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
      reader.onload = ev => {
        const data = new Uint8Array(ev.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        setDataString(csv);
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert("Unsupported file format. Please upload CSV, TXT, XLS, or XLSX.");
    }
  }, []);

  const totalDays = useMemo(() => (minDate && maxDate)
    ? Math.ceil((maxDate - minDate) / 86400000) : 0, [minDate, maxDate]);

  const filteredStartDate = useMemo(() =>
    minDate ? new Date(minDate.getTime() + dateRange[0] * 86400000) : null,
    [minDate, dateRange]);

  const filteredEndDate = useMemo(() =>
    minDate ? new Date(minDate.getTime() + dateRange[1] * 86400000) : null,
    [minDate, dateRange]);

  const resetAutoFit = () => setChartKey(prev => prev + 1);

  // Receive parameters from chart component
  const handleParameters = useCallback((params) => {
    setChartParams(prev => JSON.stringify(prev) !== JSON.stringify(params) ? params : prev);
  }, []);

  const forecast60Avg = useMemo(() => (chartParams && chartParams.forecastAverage) || {}, [chartParams]);
  useEffect(() => {
    const newJSON = JSON.stringify(forecast60Avg, null, 2);
    if (sixtyDayJSON !== newJSON) {
      setSixtyDayJSON(newJSON);
      setSixtyDayAverages(forecast60Avg);
    }
  }, [forecast60Avg, sixtyDayJSON]);

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <h2>Custom DCA Application</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <label>
          Upload CSV/Excel:&nbsp;
          <input type="file" onChange={handleFileUpload} />
        </label>
        <button onClick={() => setShowDataInput(prev => !prev)}>
          {showDataInput ? "Hide CSV Data" : "Show CSV Data"}
        </button>
      </div>
      {showDataInput && (
        <div style={{ marginBottom: 10 }}>
          <textarea
            value={dataString}
            onChange={e => setDataString(e.target.value)}
            placeholder="Paste CSV data here..."
            rows={6} cols={80}
          />
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <button onClick={() => setShow60DayAverages(prev => !prev)}>
          {show60DayAverages ? "Hide 60-Day Averages" : "Show 60-Day Averages"}
        </button>
      </div>
      {show60DayAverages && sixtyDayAverages && (
        <div style={{
          background: '#f9f9f9', border: '1px solid #ccc', padding: 10,
          marginBottom: 10, borderRadius: 4
        }}>
          <h4 style={{ marginTop: 0 }}>60-Day Forecast Averages</h4>
          <pre style={{ margin: 0 }}>{sixtyDayJSON}</pre>
        </div>
      )}
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flexGrow: 1, position: 'relative' }}>
          <div style={{
            position: 'absolute', top: 10, left: 10,
            zIndex: 100, display: 'flex', gap: '10px'
          }}>
            <button
              onClick={() => setShowInstructions(p => !p)}
              style={{
                padding: '6px 12px', border: 'none', background: '#666',
                color: '#fff', borderRadius: '4px', cursor: 'pointer'
              }}
            >
              {showInstructions ? "Hide Instructions" : "Show Instructions"}
            </button>
            <button
              onClick={() => setShowParameters(p => !p)}
              style={{
                padding: '6px 12px', border: 'none', background: '#1890ff',
                color: '#fff', borderRadius: '4px', cursor: 'pointer'
              }}
            >
              {showParameters ? "Hide Parameters" : "Show Parameters"}
            </button>
          </div>
          {showParameters && chartParams && (
            <div style={{
              position: 'absolute', top: 50, right: 10,
              background: 'rgba(255,255,255,0.98)', border: '1px solid #ccc',
              padding: 15, zIndex: 1000, maxWidth: 300, borderRadius: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <h4 style={{ marginTop: 0, marginBottom: 10 }}>Decline Parameters</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid #ddd', padding: '8px', background: '#f5f5f5' }}>Phase</th>
                    <th style={{ border: '1px solid #ddd', padding: '8px', background: '#f5f5f5' }}>Qi</th>
                    <th style={{ border: '1px solid #ddd', padding: '8px', background: '#f5f5f5' }}>b</th>
                    <th style={{ border: '1px solid #ddd', padding: '8px', background: '#f5f5f5' }}>D</th>
                    <th style={{ border: '1px solid #ddd', padding: '8px', background: '#f5f5f5' }}>EUR</th>
                  </tr>
                </thead>
                <tbody>
                  {chartParams.phaseParams && Object.keys(chartParams.phaseParams).map(phase => (
                    <tr key={phase}>
                      <td style={{ border: '1px solid #ddd', padding: '8px', fontWeight: 'bold' }}>
                        {phase.toUpperCase()}
                      </td>
                      <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'right' }}>
                        {chartParams.phaseParams[phase].Qi.toFixed(2)}
                      </td>
                      <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'right' }}>
                        {chartParams.phaseParams[phase].b.toFixed(3)}
                      </td>
                      <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'right' }}>
                        {chartParams.phaseParams[phase].D.toFixed(4)}
                      </td>
                      <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'right' }}>
                        {typeof chartParams.calculatedEUR[phase] === 'number'
                          ? Math.round(chartParams.calculatedEUR[phase]).toLocaleString()
                          : chartParams.calculatedEUR[phase]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                onClick={() => setShowParameters(false)}
                style={{
                  marginTop: 15, padding: '6px 12px',
                  background: '#f5f5f5', border: '1px solid #ccc',
                  borderRadius: '4px', cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          )}
          {showInstructions && (
            <div style={{
              position: 'absolute', top: 50, left: 10,
              background: 'rgba(255,255,255,0.98)', border: '1px solid #ccc',
              padding: 15, zIndex: 1000, maxWidth: 300, borderRadius: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <h4 style={{ marginTop: 0, marginBottom: 10 }}>Interactive Controls</h4>
              <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
                <li style={{ marginBottom: 8 }}>
                  Hold <strong>D</strong> key and drag to adjust decline rate (D)
                </li>
                <li style={{ marginBottom: 8 }}>
                  Hold <strong>Q</strong> key and drag to adjust initial rate (Qi)
                </li>
                <li style={{ marginBottom: 8 }}>
                  Hold <strong>B</strong> key and drag to adjust decline exponent (b)
                </li>
                <li style={{ marginBottom: 8 }}>
                  Mouse over the chart to see tooltip values
                </li>
                <li style={{ marginBottom: 8 }}>
                  Dragging disables autofit until reset
                </li>
              </ul>
              <button
                onClick={() => setShowInstructions(false)}
                style={{
                  marginTop: 5, padding: '6px 12px',
                  background: '#f5f5f5', border: '1px solid #ccc',
                  borderRadius: '4px', cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          )}
          <div style={{ marginBottom: 50 }}>
            <InteractiveDCAChart
              key={chartKey}
              dataString={dataString}
              startDate={filteredStartDate ? filteredStartDate.toISOString().slice(0,10) : ""}
              endDate={filteredEndDate ? filteredEndDate.toISOString().slice(0,10) : ""}
              colors={colors}
              yScaleType={yScaleType}
              forecastDays={forecastDays}
              onParametersCalculated={handleParameters}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <label>
              Production Date Range:
              <Slider.Range
                min={0}
                max={totalDays}
                value={dateRange}
                onChange={nr => setDateRange(nr)}
                tipFormatter={val => minDate ? new Date(minDate.getTime() + val * 86400000).toDateString() : ''}
              />
            </label>
            <div style={{ marginTop: 5 }}>
              {filteredStartDate ? filteredStartDate.toDateString() : 'N/A'} – {filteredEndDate ? filteredEndDate.toDateString() : 'N/A'}
            </div>
          </div>
        </div>
        <div style={{ width: 250 }}>
          <div style={{ marginBottom: 20 }}>
            <h4>Phase Colors</h4>
            {['oil', 'water', 'gas', 'pressure'].map(phase => (
              <div key={phase} style={{ marginBottom: 5 }}>
                <label>
                  {phase.toUpperCase()}:
                  <input
                    type="color"
                    value={colors[phase]}
                    onChange={e => setColors(prev => ({ ...prev, [phase]: e.target.value }))}
                    style={{ marginLeft: 5 }}
                  />
                </label>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 20 }}>
            <h4>Axis & Forecast</h4>
            <div style={{ marginBottom: 10 }}>
              <label>
                <input
                  type="radio"
                  name="yScaleType"
                  value="linear"
                  checked={yScaleType === "linear"}
                  onChange={() => setYScaleType("linear")}
                /> Linear
              </label>
              <label style={{ marginLeft: 10 }}>
                <input
                  type="radio"
                  name="yScaleType"
                  value="log"
                  checked={yScaleType === "log"}
                  onChange={() => setYScaleType("log")}
                /> Log
              </label>
            </div>
            <div>
              <label>
                Forecast Extension (Days): {forecastDays}
                <input
                  type="range"
                  min="30"
                  max="365"
                  step="30"
                  value={forecastDays}
                  onChange={e => setForecastDays(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </label>
            </div>
          </div>
          <div>
            <button
              onClick={resetAutoFit}
              style={{
                padding: '6px 12px', border: 'none', background: '#fa541c',
                color: '#fff', borderRadius: '4px', cursor: 'pointer'
              }}
            >
              Reset Autofit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
