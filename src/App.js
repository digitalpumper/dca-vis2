// src/App.js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import * as XLSX from 'xlsx';
import InteractiveDCAChart from './InteractiveDCAChart';
import DualRangeSlider from './DualRangeSlider';
import { detectDateColumn } from './dca';

function App() {
  const [dataString, setDataString] = useState('');
  const [minDate, setMinDate] = useState(null);
  const [maxDate, setMaxDate] = useState(null);
  const [sliderRange, setSliderRange] = useState([0, 1]);
  const [filterRange, setFilterRange] = useState([0, 1]);

  // Always show these controls for debugging, even when embedded.
  const [showDataInput, setShowDataInput] = useState(true);
  const [showParameters, setShowParameters] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [show60DayAverages, setShow60DayAverages] = useState(false);

  const [isEmbedded, setIsEmbedded] = useState(false);
  const [isLoadingFromSpotfire, setIsLoadingFromSpotfire] = useState(false);

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

  useEffect(() => {
    try {
      setIsEmbedded(window.self !== window.top);
      // Notify parent window (Spotfire) if embedded
      if (window.self !== window.top) {
        window.parent.postMessage({
          type: 'ready',
          status: 'initialized'
        }, '*');
      }
    } catch (e) {
      setIsEmbedded(true);
    }
  }, []);

  // Listen for messages from Spotfire (if any)
  useEffect(() => {
    function handleMessage(event) {
      if (event.origin !== window.location.origin && 
          !event.origin.includes('spotfire.com') && 
          !event.origin.includes('tibco.com')) {
        console.log('Message from untrusted origin:', event.origin);
        return;
      }
      
      if (event.data && event.data.type === 'spotfireData') {
        console.log('Received data from Spotfire');
        setIsLoadingFromSpotfire(true);
        try {
          if (event.data.rawCSV) {
            setDataString(event.data.rawCSV);
          } else if (event.data.data && event.data.headers) {
            const csvRows = [event.data.headers.join(',')];
            event.data.data.forEach(row => {
              const values = event.data.headers.map(header => {
                const val = row[header];
                return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
              });
              csvRows.push(values.join(','));
            });
            setDataString(csvRows.join('\n'));
          }
          if (window.parent) {
            window.parent.postMessage({
              type: 'dataReceived',
              status: 'success'
            }, '*');
          }
          setIsLoadingFromSpotfire(false);
        } catch (error) {
          console.error('Error processing Spotfire data:', error);
          if (window.parent) {
            window.parent.postMessage({
              type: 'error',
              message: error.message
            }, '*');
          }
          setIsLoadingFromSpotfire(false);
        }
      }
    }
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Handle file upload for CSV, TXT, XLS, XLSX
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

  // Load sample data if not embedded and no data provided
  useEffect(() => {
    if (!isEmbedded && !dataString) {
      fetch('/sample-data.csv')
        .then(response => {
          if (!response.ok) throw new Error('Sample data not found');
          return response.text();
        })
        .then(text => setDataString(text))
        .catch(err => console.warn('Could not load sample data:', err));
    }
  }, [isEmbedded, dataString]);

  // Update date range from CSV data
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
          const computedDays = Math.ceil((maxD - minD) / (1000 * 60 * 60 * 24));
          const totalDays = computedDays > 0 ? computedDays : 1;
          setSliderRange([0, totalDays]);
          setFilterRange([0, totalDays]);
        }
      }
    } catch (err) {
      console.error("Error parsing CSV:", err);
    }
  }, [dataString]);

  const totalDays = useMemo(() => {
    if (minDate && maxDate) {
      const diff = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
      return diff > 0 ? diff : 1;
    }
    return 1;
  }, [minDate, maxDate]);

  const filteredStartDate = useMemo(() => {
    return minDate ? new Date(minDate.getTime() + filterRange[0] * 86400000) : null;
  }, [minDate, filterRange]);

  const filteredEndDate = useMemo(() => {
    return minDate ? new Date(minDate.getTime() + filterRange[1] * 86400000) : null;
  }, [minDate, filterRange]);

  const resetAutoFit = () => setChartKey(prev => prev + 1);

  const handleParameters = useCallback((params) => {
    setChartParams(prev => {
      if (JSON.stringify(prev) !== JSON.stringify(params)) {
        return params;
      }
      return prev;
    });
  }, []);

  const forecast60Avg = useMemo(() => (chartParams && chartParams.forecastAverage) || {}, [chartParams]);
  useEffect(() => {
    const newJSON = JSON.stringify(forecast60Avg, null, 2);
    if (sixtyDayJSON !== newJSON) {
      setSixtyDayJSON(newJSON);
      setSixtyDayAverages(forecast60Avg);
    }
  }, [forecast60Avg, sixtyDayJSON]);

  const tipFormatter = (val) => {
    return minDate ? new Date(minDate.getTime() + val * 86400000).toDateString() : val;
  };

  const handleFinalChange = useCallback(() => {
    setFilterRange(sliderRange);
  }, [sliderRange]);

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif' }}>
      {/* Changed header text */}
      <h2>Custom DCA Application</h2>
      
      {/* Always show upload controls and CSV Data button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <label>
          Upload CSV/Excel:&nbsp;
          <input type="file" onChange={handleFileUpload} />
        </label>
        <button onClick={() => setShowDataInput(prev => !prev)}>
          {showDataInput ? "Hide CSV Data" : "Show CSV Data"}
        </button>
      </div>
      
      {/* CSV text area for debugging */}
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
      
      {/* Debug area showing raw CSV data */}
      <div style={{ marginBottom: 10 }}>
        <h4>Debug: Raw CSV Data</h4>
        <pre style={{ background: '#eee', padding: '10px' }}>{dataString}</pre>
      </div>
      
      {isLoadingFromSpotfire && (
        <div style={{ 
          padding: '10px', 
          backgroundColor: '#e6f7ff', 
          border: '1px solid #91d5ff',
          borderRadius: '4px',
          marginBottom: '10px'
        }}>
          Loading data from Spotfire...
        </div>
      )}
      
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flexGrow: 1, position: 'relative' }}>
          <div style={{
            position: 'absolute', top: 10, left: 10,
            zIndex: 100, display: 'flex', gap: '10px'
          }}>
            <button onClick={() => setShowInstructions(p => !p)}
              style={{
                padding: '6px 12px', border: 'none', background: '#666',
                color: '#fff', borderRadius: '4px', cursor: 'pointer'
              }}>
              {showInstructions ? "Hide Instructions" : "Show Instructions"}
            </button>
            <button onClick={() => setShowParameters(p => !p)}
              style={{
                padding: '6px 12px', border: 'none', background: '#1890ff',
                color: '#fff', borderRadius: '4px', cursor: 'pointer'
              }}>
              {showParameters ? "Hide Parameters" : "Show Parameters"}
            </button>
          </div>
          
          {showInstructions && (
            <div style={{
              position: 'absolute',
              top: '50px',
              left: '10px',
              zIndex: '90',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              padding: '15px',
              borderRadius: '5px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
              maxWidth: '300px'
            }}>
              <h4 style={{ marginTop: 0 }}>Instructions</h4>
              <ul style={{ paddingLeft: '20px', margin: '0' }}>
                <li>Drag curves vertically to adjust parameters</li>
                <li>By default, adjust Q proportionally</li>
                <li>Hold D key to adjust D inversely</li>
                <li>Hold B key to adjust both B and D inversely</li>
                <li>Auto-fit is disabled after first drag</li>
                <li>Use date range slider to filter time period</li>
              </ul>
            </div>
          )}
          
          {showParameters && chartParams && (
            <div style={{
              position: 'absolute',
              top: '50px',
              right: '10px',
              zIndex: '90',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              padding: '15px',
              borderRadius: '5px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
              maxWidth: '300px'
            }}>
              <h4 style={{ marginTop: 0 }}>Current Parameters</h4>
              <pre style={{ fontSize: '12px', maxHeight: '300px', overflowY: 'auto' }}>
                {JSON.stringify(chartParams, null, 2)}
              </pre>
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
              <DualRangeSlider
                min={0}
                max={totalDays}
                values={sliderRange}
                onChange={setSliderRange}
                tipFormatter={tipFormatter}
                onFinalChange={handleFinalChange}
              />
            </label>
            <div style={{ marginTop: 5 }}>
              {minDate
                ? `${new Date(minDate.getTime() + filterRange[0] * 86400000).toDateString()} – ${new Date(minDate.getTime() + filterRange[1] * 86400000).toDateString()}`
                : 'N/A'}
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

export default App;
