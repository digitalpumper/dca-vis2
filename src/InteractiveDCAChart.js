import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';

const calculateRate = (Qi, b, D, t) => {
  if (b === 0) {
    return Qi * Math.exp(-D * t);
  }
  return Qi / Math.pow(1 + b * D * t, 1 / b);
};

function detectDateColumn(columns) {
  const candidates = columns.filter(h => {
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

function detectColumns(columns) {
  let phases = {};
  columns.forEach(header => {
    const lower = header.toLowerCase();
    if (lower.includes("bopd") || (lower.includes("oil") && !phases.oil)) {
      phases.oil = header;
    }
    if (lower.includes("bwpd") || (lower.includes("water") && !phases.water)) {
      phases.water = header;
    }
    if (lower.includes("mcfd") || (lower.includes("gas") && !phases.gas)) {
      phases.gas = header;
    }
    if ((lower.includes("pip") || lower.includes("pressure") || lower.includes("psi")) && !phases.pressure) {
      phases.pressure = header;
    }
  });
  return phases;
}

export default function InteractiveDCAChart({
  dataString,
  startDate,
  endDate,
  colors,
  yScaleType,
  yMultiplier,
  forecastDays,
  autoForecast = true,
  onParametersCalculated
}) {
  const svgRef = useRef(null);
  const xScaleRef = useRef(null);
  const yScaleRef = useRef(null);
  
  // Store drag state in refs to avoid re-renders
  const dragStartRef = useRef(null);
  
  // For tooltip
  const [hoverInfo, setHoverInfo] = useState(null);
  
  // Parameters
  const [phaseParams, setPhaseParams] = useState({});
  const [autoFitEnabled, setAutoFitEnabled] = useState(true);
  const [activeKey, setActiveKey] = useState(null);
  const [activePhase, setActivePhase] = useState(null);
  
  // Prevent infinite loops
  const prevParamsRef = useRef({});
  const lastOnParamsCallRef = useRef(null);
  
  // Parse CSV data
  const parsedData = useMemo(() => {
    try {
      return d3.csvParse(dataString);
    } catch (err) {
      console.error("Error parsing CSV:", err);
      return [];
    }
  }, [dataString]);
  
  // Basic data processing
  const hasData = parsedData.length > 0;
  const prodDateCol = useMemo(() => 
    hasData ? detectDateColumn(parsedData.columns) : "Production_Date", 
  [hasData, parsedData]);
  
  const phasesDetected = useMemo(() => 
    hasData ? detectColumns(parsedData.columns) : {}, 
  [hasData, parsedData]);
  
  // Filter data based on date range
  const filteredData = useMemo(() => {
    if (!hasData) return [];
    
    // Parse dates and filter invalid
    let arr = parsedData.map(row => ({
      ...row,
      [prodDateCol]: new Date(row[prodDateCol])
    })).filter(row => !isNaN(row[prodDateCol].getTime()));
    
    // Sort by date
    arr.sort((a, b) => a[prodDateCol] - b[prodDateCol]);
    
    // Apply date filters if provided
    if (startDate) {
      const sd = new Date(startDate);
      arr = arr.filter(row => row[prodDateCol] >= sd);
    }
    if (endDate) {
      const ed = new Date(endDate);
      arr = arr.filter(row => row[prodDateCol] <= ed);
    }
    
    return arr;
  }, [parsedData, prodDateCol, startDate, endDate, hasData]);
  
  const localHasData = filteredData.length > 0;
  
  // Get first date and calculate relative times
  const firstDate = useMemo(() => 
    localHasData ? filteredData[0][prodDateCol] : new Date(),
  [localHasData, filteredData, prodDateCol]);
  
  const data = useMemo(() => {
    if (!localHasData) return [];
    return filteredData.map(row => {
      const date = row[prodDateCol];
      return { 
        ...row, 
        t: (date - firstDate) / (1000 * 60 * 60 * 24) 
      };
    });
  }, [filteredData, localHasData, firstDate, prodDateCol]);
  
  // Extract phase data
  const phaseData = useMemo(() => {
    let result = {};
    Object.keys(phasesDetected).forEach(phase => {
      result[phase] = data.map(d => ({
        t: d.t,
        value: +d[phasesDetected[phase]]
      })).filter(d => !isNaN(d.value));
    });
    return result;
  }, [data, phasesDetected]);
  
  // Get max time and last production date
  const tMax = useMemo(() => 
    localHasData ? d3.max(data, d => d.t) : 0,
  [data, localHasData]);
  
  const lastProdDate = useMemo(() => 
    localHasData ? d3.max(data, d => d[prodDateCol]) : new Date(),
  [data, localHasData, prodDateCol]);
  
  // Auto-fit parameters (simplified)
  useEffect(() => {
    if (!localHasData || !autoFitEnabled) return;
    
    let newParams = {};
    Object.keys(phaseData).forEach(phase => {
      const points = phaseData[phase];
      if (points.length < 3) {
        newParams[phase] = { Qi: points?.[0]?.value || 100, b: 0.5, D: 0.05 };
      } else {
        // Simple fit - find the first and last points
        const first = points[0];
        const last = points[points.length - 1];
        
        // Default values
        const Qi = first.value;
        const b = 0.5;  // Reasonable default
        
        // Calculate D based on decline between first and last points
        const ratio = last.value / first.value;
        const t = last.t - first.t;
        
        let D;
        if (b === 0) {
          // Exponential
          D = -Math.log(ratio) / t;
        } else {
          // Hyperbolic
          D = ((1 / ratio) ** b - 1) / (b * t);
        }
        
        // Ensure D is reasonable
        D = Math.max(0.001, Math.min(0.5, D));
        
        newParams[phase] = { Qi, b, D };
      }
    });
    
    // Only update if parameters changed
    if (JSON.stringify(newParams) !== JSON.stringify(prevParamsRef.current)) {
      prevParamsRef.current = newParams;
      setPhaseParams(newParams);
    }
  }, [phaseData, localHasData, autoFitEnabled]);
  
  // Convert phase data to points for plotting
  const allHistoricalPoints = useMemo(() => {
    let out = [];
    Object.keys(phaseData).forEach(phase => {
      phaseData[phase].forEach(d => {
        out.push({
          date: new Date(firstDate.getTime() + d.t * 86400000),
          Q: d.value,
          phase
        });
      });
    });
    return out;
  }, [phaseData, firstDate]);
  
  // Simple forecast calculation
  const allForecastPoints = useMemo(() => {
    if (!localHasData) return {};
    
    let out = {};
    Object.keys(phaseParams).forEach(phase => {
      const { Qi, b, D } = phaseParams[phase] || {};
      if (!Qi || D <= 0) {
        out[phase] = [];
        return;
      }
      
      // Calculate last rate at tMax
      const lastRate = calculateRate(Qi, b, D, tMax);
      
      // Create forecast points
      const points = [];
      const steps = 50;
      
      // Add the start point (last production date)
      points.push({
        date: lastProdDate,
        Q: lastRate,
        phase
      });
      
      // Add forecast points
      for (let i = 1; i <= steps; i++) {
        const days = (i / steps) * forecastDays;
        const t = tMax + days;
        
        const Q = calculateRate(Qi, b, D, t);
        const date = new Date(lastProdDate.getTime() + days * 86400000);
        
        points.push({
          date,
          Q,
          phase
        });
      }
      
      out[phase] = points;
    });
    
    return out;
  }, [phaseParams, tMax, lastProdDate, forecastDays, localHasData]);
  
  // Calculate EUR and forecast average
  const calculatedEUR = useMemo(() => {
    let results = {};
    Object.keys(phaseParams).forEach(phase => {
      const { Qi, b, D } = phaseParams[phase] || {};
      if (!Qi || D <= 0) {
        results[phase] = "N/A";
        return;
      }
      
      if (b === 0) results[phase] = Qi / D;
      else if (b > 0 && b < 1) results[phase] = Qi / (D * (1 - b));
      else if (b === 1) results[phase] = Qi * 10000;
      else results[phase] = "N/A";
    });
    return results;
  }, [phaseParams]);
  
  const forecastAverage = useMemo(() => {
    let fa = {};
    Object.keys(phaseParams).forEach(phase => {
      const { Qi, b, D } = phaseParams[phase] || {};
      if (!Qi || D <= 0) {
        fa[phase] = 0;
        return;
      }
      
      const Q_start = calculateRate(Qi, b, D, tMax);
      const steps = 60;
      let sum = 0;
      
      for (let i = 0; i <= steps; i++) {
        const t = tMax + (i / steps) * 60;
        const Q = calculateRate(Qi, b, D, t);
        sum += Q;
      }
      
      fa[phase] = sum / (steps + 1);
    });
    return fa;
  }, [phaseParams, tMax]);
  
  // Call onParametersCalculated when params change
  useEffect(() => {
    if (!onParametersCalculated) return;
    
    const newParams = { phaseParams, calculatedEUR, forecastAverage };
    const stringifiedNew = JSON.stringify(newParams);
    const stringifiedPrev = JSON.stringify(lastOnParamsCallRef.current);
    
    if (stringifiedNew !== stringifiedPrev) {
      lastOnParamsCallRef.current = newParams;
      onParametersCalculated(newParams);
    }
  }, [phaseParams, calculatedEUR, forecastAverage, onParametersCalculated]);
  
  // Enhanced key event handling
  useEffect(() => {
    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if (["d", "q", "b"].includes(key)) {
        setActiveKey(key);
      }
    };
    
    const handleKeyUp = () => {
      setActiveKey(null);
      // Clear drag start when key is released
      dragStartRef.current = null;
    };
    
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);
  
  // Helper function to get appropriate sensitivity for each parameter
  const getAdjustmentForDrag = (key, dy, originalValue) => {
    switch (key) {
      case "d":
        // Very fine control for D parameter - percentage based change
        return Math.max(0.0001, originalValue * (1 - dy * 0.0005));
      case "q":
        // Linear change for Qi but not too extreme
        return Math.max(1, originalValue - dy * 0.5);
      case "b":
        // Fine control for b with range limiting
        return Math.max(0, Math.min(1, originalValue + dy * 0.002));
      default:
        return originalValue;
    }
  };
  
  // D3 rendering
  useEffect(() => {
    if (!localHasData || !svgRef.current) {
      return;
    }
    
    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const width = 800;
    const height = 400;
    const svg = d3.select(svgRef.current);
    
    // Clear previous content
    svg.selectAll("*").remove();
    
    // Create chart area group with z-index layering
    const baseLayer = svg.append("g").attr("class", "base-layer");
    const dataLayer = svg.append("g").attr("class", "data-layer");
    const forecastLayer = svg.append("g").attr("class", "forecast-layer");
    const axisLayer = svg.append("g").attr("class", "axis-layer");
    const overlayLayer = svg.append("g").attr("class", "overlay-layer");
    
    // Create background for plot area
    baseLayer.append("rect")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", width - margin.left - margin.right)
      .attr("height", height - margin.top - margin.bottom)
      .attr("fill", "#f8f8f8")
      .attr("stroke", "#ccc");
    
    // Set up scales
    const dateExtent = d3.extent([
      ...allHistoricalPoints.map(d => d.date),
      ...Object.values(allForecastPoints).flat().map(d => d.date)
    ]);
    
    const minDate = dateExtent[0] || new Date();
    const maxDate = dateExtent[1] || new Date();
    
    const qValues = [
      ...allHistoricalPoints.map(d => d.Q),
      ...Object.values(allForecastPoints).flat().map(d => d.Q)
    ];
    
    const qExtent = d3.extent(qValues);
    let minQ = qExtent[0] || 0;
    let maxQ = qExtent[1] || 100;
    
    // Add padding for Y axis
    if (yScaleType !== "log") {
      const qRange = maxQ - minQ;
      maxQ = maxQ + qRange * 0.1;
      minQ = Math.max(0, minQ - qRange * 0.05);
    } else if (minQ <= 0) {
      minQ = 0.01;
    }
    
    // Create scales
    const xScale = d3.scaleTime()
      .domain([minDate, maxDate])
      .range([margin.left, width - margin.right]);
    
    xScaleRef.current = xScale;
    
    const yScale = yScaleType === "log"
      ? d3.scaleLog()
          .domain([Math.max(0.01, minQ), maxQ])
          .range([height - margin.bottom, margin.top])
      : d3.scaleLinear()
          .domain([minQ, maxQ])
          .range([height - margin.bottom, margin.top]);
    
    yScaleRef.current = yScale;
    
    // Add grid lines
    baseLayer.append("g")
      .attr("class", "grid y-grid")
      .attr("opacity", 0.3)
      .attr("transform", `translate(${margin.left},0)`)
      .call(
        d3.axisLeft(yScale)
          .tickSize(-(width - margin.left - margin.right))
          .tickFormat("")
      );
    
    baseLayer.append("g")
      .attr("class", "grid x-grid")
      .attr("opacity", 0.3)
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(
        d3.axisBottom(xScale)
          .tickSize(-(height - margin.top - margin.bottom))
          .tickFormat("")
      );
    
    // Draw historical data points
    Object.keys(phasesDetected).forEach(phase => {
      const points = allHistoricalPoints.filter(p => p.phase === phase);
      
      dataLayer.selectAll(`circle.${phase}`)
        .data(points)
        .enter()
        .append("circle")
        .attr("class", phase)
        .attr("cx", d => xScale(d.date))
        .attr("cy", d => yScale(d.Q))
        .attr("r", 3)
        .attr("fill", colors[phase] || "#888");
    });
    
    // Draw historical trend lines
    Object.keys(phaseParams).forEach(phase => {
      // Only draw if we have parameters and data
      if (!phaseParams[phase] || !phaseData[phase]?.length) return;
      
      const { Qi, b, D } = phaseParams[phase];
      
      // Create line data
      const lineData = [];
      const steps = 100;
      
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const t = tMax * frac;
        const Q = calculateRate(Qi, b, D, t);
        const date = new Date(firstDate.getTime() + t * 86400000);
        
        lineData.push({ date, Q });
      }
      
      // Create line generator
      const lineGen = d3.line()
        .x(d => xScale(d.date))
        .y(d => yScale(d.Q))
        .curve(d3.curveMonotoneX);
      
      // Draw line
      dataLayer.append("path")
        .datum(lineData)
        .attr("class", `decline-line-${phase}`)
        .attr("fill", "none")
        .attr("stroke", colors[phase] || "#888")
        .attr("stroke-width", 2)
        .attr("d", lineGen)
        .style("cursor", "pointer")
        .on("mouseover", function() {
          // Highlight on hover
          d3.select(this).attr("stroke-width", 4);
        })
        .on("mouseout", function() {
          // Reset to normal if not active
          if (phase !== activePhase) {
            d3.select(this).attr("stroke-width", 2);
          }
        })
        .on("mousedown", function(event) {
          // Set this as the active phase
          setActivePhase(phase);
          d3.select(this).attr("stroke-width", 4);
          
          // Only initiate drag if a key is pressed
          if (activeKey) {
            if (autoFitEnabled) setAutoFitEnabled(false);
            
            // Store start position and original parameters
            dragStartRef.current = {
              y: event.y,
              params: { ...phaseParams[phase] }
            };
          }
        });
    });
    
    // Add drag behavior to the entire SVG
    svg.call(
      d3.drag()
        .filter(() => activeKey !== null && activePhase !== null)
        .on("drag", function(event) {
          if (!activeKey || !activePhase || !dragStartRef.current) return;
          
          const { y, params } = dragStartRef.current;
          const dy = event.y - y;
          
          setPhaseParams(prev => {
            const copy = { ...prev };
            if (!copy[activePhase]) return prev;
            
            const curr = { ...copy[activePhase] };
            
            // Apply parameter adjustment based on key and drag distance
            if (activeKey === "d") {
              curr.D = getAdjustmentForDrag("d", dy, params.D);
            } else if (activeKey === "q") {
              curr.Qi = getAdjustmentForDrag("q", dy, params.Qi);
            } else if (activeKey === "b") {
              curr.b = getAdjustmentForDrag("b", dy, params.b);
            }
            
            copy[activePhase] = curr;
            return copy;
          });
        })
        .on("end", function() {
          // Clean up when drag ends
          dragStartRef.current = null;
        })
    );
    
    // Draw forecast lines
    Object.keys(allForecastPoints).forEach(phase => {
      const forecastPoints = allForecastPoints[phase];
      
      if (forecastPoints.length > 1) {
        const lineGen = d3.line()
          .x(d => xScale(d.date))
          .y(d => yScale(d.Q))
          .curve(d3.curveMonotoneX);
        
        forecastLayer.append("path")
          .datum(forecastPoints)
          .attr("class", `forecast-line-${phase}`)
          .attr("fill", "none")
          .attr("stroke", d3.color(colors[phase] || "#888").brighter(1.2))
          .attr("stroke-width", 3)
          .attr("stroke-dasharray", "5,3")
          .attr("d", lineGen)
          .on("mouseover", function() {
            d3.select(this).attr("stroke-width", 5);
          })
          .on("mouseout", function() {
            d3.select(this).attr("stroke-width", 3);
          });
      }
    });
    
    // Add vertical line at last production date
    overlayLayer.append("line")
      .attr("x1", xScale(lastProdDate))
      .attr("y1", margin.top)
      .attr("x2", xScale(lastProdDate))
      .attr("y2", height - margin.bottom)
      .attr("stroke", "#666")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "5,5");
    
    // Add forecast label
    overlayLayer.append("text")
      .attr("x", xScale(lastProdDate) + 5)
      .attr("y", margin.top + 15)
      .attr("fill", "#666")
      .text("Forecast →");
    
    // Add axes
    const xAxis = d3.axisBottom(xScale)
      .tickFormat(d3.timeFormat("%Y-%m-%d"));
    
    axisLayer.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(xAxis)
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end");
    
    const yAxis = yScaleType === "log"
      ? d3.axisLeft(yScale).ticks(6, "~s")
      : d3.axisLeft(yScale);
    
    axisLayer.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(yAxis);
    
    // Add axis labels
    axisLayer.append("text")
      .attr("x", width / 2)
      .attr("y", height - 5)
      .style("text-anchor", "middle")
      .text("Date");
    
    axisLayer.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", 15)
      .style("text-anchor", "middle")
      .text("Production Rate");
    
    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 10])
      .on("zoom", event => {
        const newYScale = event.transform.rescaleY(yScale);
        yScaleRef.current = newYScale;
        
        // Update circles
        dataLayer.selectAll("circle")
          .attr("cy", d => newYScale(d.Q));
        
        // Update historical paths
        dataLayer.selectAll("path")
          .attr("d", function(d) {
            if (!Array.isArray(d)) return;
            
            const lineGen = d3.line()
              .x(d => xScale(d.date))
              .y(d => newYScale(d.Q))
              .curve(d3.curveMonotoneX);
            
            return lineGen(d);
          });
        
        // Update forecast paths
        forecastLayer.selectAll("path")
          .attr("d", function(d) {
            if (!Array.isArray(d)) return;
            
            const lineGen = d3.line()
              .x(d => xScale(d.date))
              .y(d => newYScale(d.Q))
              .curve(d3.curveMonotoneX);
            
            return lineGen(d);
          });
        
        // Update y-axis
        axisLayer.select("g")
          .call(yAxis.scale(newYScale));
      });
    
    svg.call(zoom);
    
  }, [
    localHasData,
    allHistoricalPoints,
    allForecastPoints,
    phasesDetected,
    phaseParams,
    phaseData,
    firstDate,
    tMax,
    lastProdDate,
    yScaleType,
    colors,
    activeKey,
    activePhase,
    forecastDays
  ]);
  
  // Render component
  return (
    <div style={{ position: 'relative' }}>
      {/* Status indicator - positioned absolutely below the chart */}
      <div 
        style={{ 
          position: 'absolute', 
          bottom: -45, 
          left: 0,
          display: 'flex',
          gap: 20,
          alignItems: 'center',
          fontSize: 12,
          color: '#666',
          zIndex: 5
        }}
      >
        <div>
          <strong>Key:</strong> {activeKey ? activeKey.toUpperCase() : "None"}
        </div>
        <div>
          <strong>Phase:</strong> {activePhase ? activePhase.toUpperCase() : "None"}
        </div>
        <div>
          <strong>Instructions:</strong> Hold D, Q, or B key and drag to adjust
        </div>
      </div>
      
      <svg
        ref={svgRef}
        width={800}
        height={400}
        onMouseMove={(event) => {
          if (!localHasData || !xScaleRef.current) return;
          
          const [mouseX] = d3.pointer(event, svgRef.current);
          const date = xScaleRef.current.invert(mouseX);
          const t = (date - firstDate) / 86400000;
          
          let vals = {};
          Object.keys(phaseParams).forEach(phase => {
            const { Qi, b, D } = phaseParams[phase] || {};
            if (Qi && b !== undefined && D) {
              vals[phase] = calculateRate(Qi, b, D, t);
            }
          });
          
          setHoverInfo({ x: mouseX, date, values: vals });
        }}
        onMouseOut={() => setHoverInfo(null)}
      />
      
      {hoverInfo && (
        <div
          style={{
            position: 'absolute',
            left: hoverInfo.x + 5,
            top: 0,
            pointerEvents: 'none',
            background: 'rgba(255,255,255,0.9)',
            border: '1px solid #ccc',
            padding: 5,
            fontSize: 12,
            borderRadius: 4,
            zIndex: 1000
          }}
        >
          <div>{hoverInfo.date.toDateString()}</div>
          {Object.keys(hoverInfo.values).map(ph => (
            <div key={ph}>
              {ph.toUpperCase()}: {hoverInfo.values[ph].toFixed(2)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}