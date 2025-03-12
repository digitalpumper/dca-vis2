import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import * as d3 from 'd3';
import InteractiveDCAChart from './InteractiveDCAChart';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';

export default function App() {
  // 1) Data / CSV state
  const [dataString, setDataString] = useState('');
  
  // 2) Date filter states
  const [minDate, setMinDate] = useState(null);
  const [maxDate, setMaxDate] = useState(null);
  const [dateRange, setDateRange] = useState([0, 0]);

  // 3) Overlays and toggles
  const [showDataInput, setShowDataInput] = useState(false);
  const [showParameters, setShowParameters] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [show60DayAverages, setShow60DayAverages] = useState(false);

  // 4) Sidebar controls
  const [colors, setColors] = useState({
    oil: "#008000",
    water: "#0000ff",
    gas: "#ff0000",
    pressure: "#000000"
  });
  const [yScaleType, setYScaleType] = useState("linear");
  
  // 5) Let forecastDays be user-adjustable
  const [forecastDays, setForecastDays] = useState(90);

  // 6) Chart reset key (for "Reset Autofit" logic)
  const [chartKey, setChartKey] = useState(0);
  const resetAutoFit = () => setChartKey(prev => prev + 1);

  // 7) Computed chart parameters & 60-day averages
  const [chartParams, setChartParams] = useState(null);
  const [sixtyDayAverages, setSixtyDayAverages] = useState(null);
  const [sixtyDayJSON, setSixtyDayJSON] = useState("");

  // 8) Parse dataString to find min/max date
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
          const totalDays = Math.ceil((maxD - minD) / (1000 * 60 * 60 * 24));
          setDateRange([0, totalDays]);
        }
      }
    } catch (err) {
      console.error("Error parsing CSV:", err);
    }
  }, [dataString]);

  // Helper functions moved outside the component
  function detectDateColumn(headers) {
    const candidates = headers.filter(h => {
      const lower = h.toLowerCase();
      return (
        (lower.includes("prod") && lower.includes("date")) ||
        lower.includes("proddt") ||
        lower.includes("proddttm") ||
        lower === "date" ||
        lower === "datetime"
      );
    });
    return candidates.length > 0 ? candidates[0] : "Production_Date";
  }

  // 9) File upload handler
  function handleFileUpload(e) {
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
  }

  // 10) Filtered date range logic
  const totalDays = useMemo(() => {
    return (minDate && maxDate)
      ? Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24))
      : 0;
  }, [minDate, maxDate]);
  
  const filteredStartDate = useMemo(() => {
    return (minDate)
      ? new Date(minDate.getTime() + dateRange[0] * 86400000)
      : null;
  }, [minDate, dateRange]);
  
  const filteredEndDate = useMemo(() => {
    return (minDate)
      ? new Date(minDate.getTime() + dateRange[1] * 86400000)
      : null;
  }, [minDate, dateRange]);

  // 11) Receiving final chart parameters from InteractiveDCAChart
  // Use useCallback to prevent handleParameters from being recreated on each render
  const handleParameters = useCallback((params) => {
    // Only update if values have actually changed to prevent infinite loop
    setChartParams(prevParams => {
      if (!prevParams || JSON.stringify(prevParams) !== JSON.stringify(params)) {
        return params;
      }
      return prevParams;
    });
  }, []);

  // 12) If chartParams has forecastAverage, that is our 60-day data
  const forecast60Avg = useMemo(() => {
    return (chartParams && chartParams.forecastAverage) || {};
  }, [chartParams]);

  // Update sixtyDayJSON and sixtyDayAverages when forecast60Avg changes
  useEffect(() => {
    // Prevent unnecessary state updates
    const newJSON = JSON.stringify(forecast60Avg, null, 2);
    if (sixtyDayJSON !== newJSON) {
      setSixtyDayJSON(newJSON);
      setSixtyDayAverages(forecast60Avg);
    }
  }, [forecast60Avg, sixtyDayJSON]);

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <h2>Custom DCA Application</h2>
      
      {/* Row with file upload and data text toggle */}
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
            rows={6}
            cols={80}
          />
        </div>
      )}

      {/* 60-Day Averages toggle */}
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

      {/* Layout: Chart + Sidebar */}
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flexGrow: 1, position: 'relative' }}>
          {/* Overlays on top-left of chart */}
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

          {/* Parameters Overlay */}
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
                  marginTop: 15, 
                  padding: '6px 12px', 
                  background: '#f5f5f5', 
                  border: '1px solid #ccc', 
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          )}

          {/* Instructions Overlay */}
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
                  Hold <strong>D</strong> key and drag a curve up/down to adjust decline rate (D)
                </li>
                <li style={{ marginBottom: 8 }}>
                  Hold <strong>Q</strong> key and drag a curve up/down to adjust initial rate (Qi)
                </li>
                <li style={{ marginBottom: 8 }}>
                  Hold <strong>B</strong> key and drag a curve up/down to adjust decline exponent (b)
                </li>
                <li style={{ marginBottom: 8 }}>
                  Mouse over the chart to see a tooltip with values
                </li>
                <li style={{ marginBottom: 8 }}>
                  Dragging a curve disables autofit until reset
                </li>
              </ul>
              <button 
                onClick={() => setShowInstructions(false)} 
                style={{ 
                  marginTop: 5, 
                  padding: '6px 12px', 
                  background: '#f5f5f5', 
                  border: '1px solid #ccc', 
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          )}

          {/* The chart */}
          <div style={{ marginBottom: 50 }}>
            <InteractiveDCAChart
              key={chartKey}
              dataString={dataString}
              startDate={filteredStartDate ? filteredStartDate.toISOString().slice(0,10) : ""}
              endDate={filteredEndDate ? filteredEndDate.toISOString().slice(0,10) : ""}
              colors={colors}
              yScaleType={yScaleType}
              yMultiplier={1}  // fixed multiplier
              forecastDays={forecastDays}
              onParametersCalculated={handleParameters}
            />
          </div>

          {/* Production Date Range slider */}
          <div style={{ marginTop: 10 }}>
            <label>
              Production Date Range:
              <Slider.Range
                min={0}
                max={totalDays}
                value={dateRange}
                onChange={nr => setDateRange(nr)}
                tipFormatter={val => {
                  if (!minDate) return '';
                  return new Date(minDate.getTime() + val * 86400000).toDateString();
                }}
              />
            </label>
            <div style={{ marginTop: 5 }}>
              {filteredStartDate ? filteredStartDate.toDateString() : 'N/A'}
              {" – "}
              {filteredEndDate ? filteredEndDate.toDateString() : 'N/A'}
            </div>
          </div>
        </div>

        {/* Sidebar with colors, axis controls, forecastDays slider, etc. */}
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