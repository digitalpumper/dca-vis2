// src/InteractiveDCAChart.js
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { calculateRate, detectDateColumn, detectColumns } from './dca';

// Throttled mouse event hook
const useThrottledMouse = (callback, delay = 50) => {
  const frame = useRef(null);
  const lastArgs = useRef(null);
  const throttledCallback = useCallback((...args) => {
    lastArgs.current = args;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      callback(...lastArgs.current);
      frame.current = null;
    });
  }, [callback]);
  return throttledCallback;
};

const InteractiveDCAChart = React.memo(({
  dataString,
  startDate,
  endDate,
  colors,
  yScaleType,
  forecastDays,
  onParametersCalculated
}) => {
  const svgRef = useRef(null);
  const xScaleRef = useRef(null);
  const yScaleRef = useRef(null);
  const dragStartRef = useRef(null);

  const [hoverInfo, setHoverInfo] = useState(null);
  const [phaseParams, setPhaseParams] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [activePhase, setActivePhase] = useState(null);
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

  const hasData = parsedData.length > 0;
  const prodDateCol = useMemo(() =>
    hasData ? detectDateColumn(parsedData.columns) : "Production_Date",
    [hasData, parsedData]
  );
  const phasesDetected = useMemo(() =>
    hasData ? detectColumns(parsedData.columns) : {},
    [hasData, parsedData]
  );

  // Filter and sort data by date
  const filteredData = useMemo(() => {
    if (!hasData) return [];
    let arr = parsedData.map(row => ({
      ...row,
      [prodDateCol]: new Date(row[prodDateCol])
    })).filter(row => !isNaN(row[prodDateCol].getTime()));
    arr.sort((a, b) => a[prodDateCol] - b[prodDateCol]);
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
  const firstDate = useMemo(() =>
    localHasData ? filteredData[0][prodDateCol] : new Date(),
    [localHasData, filteredData, prodDateCol]
  );
  const data = useMemo(() => {
    if (!localHasData) return [];
    return filteredData.map(row => ({
      ...row,
      t: (row[prodDateCol] - firstDate) / (1000 * 60 * 60 * 24)
    }));
  }, [filteredData, localHasData, firstDate, prodDateCol]);

  // Build phase-specific time series
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

  const tMax = useMemo(() => localHasData ? d3.max(data, d => d.t) : 0, [data, localHasData]);
  const lastProdDate = useMemo(() =>
    localHasData ? d3.max(data, d => d[prodDateCol]) : new Date(),
    [data, localHasData, prodDateCol]
  );

  // Auto-fit decline parameters
  useEffect(() => {
    if (!localHasData) return;
    let newParams = {};
    Object.keys(phaseData).forEach(phase => {
      const points = phaseData[phase];
      if (points.length < 3) {
        newParams[phase] = { Qi: points?.[0]?.value || 100, b: 0.5, D: 0.05 };
      } else {
        const first = points[0];
        const last = points[points.length - 1];
        const Qi = first.value;
        const b = 0.5;
        const ratio = last.value / first.value;
        const t = last.t - first.t;
        let D = (b === 0) ? -Math.log(ratio) / t : (Math.pow(1 / ratio, b) - 1) / (b * t);
        D = Math.max(0.001, Math.min(0.5, D));
        newParams[phase] = { Qi, b, D };
      }
    });
    if (JSON.stringify(newParams) !== JSON.stringify(prevParamsRef.current)) {
      prevParamsRef.current = newParams;
      setPhaseParams(newParams);
    }
  }, [phaseData, localHasData]);

  // Historical plot points
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

  // Forecast points
  const allForecastPoints = useMemo(() => {
    if (!localHasData) return {};
    let out = {};
    Object.keys(phaseParams).forEach(phase => {
      const { Qi, b, D } = phaseParams[phase] || {};
      if (!Qi || D <= 0) {
        out[phase] = [];
        return;
      }
      const lastRate = calculateRate(Qi, b, D, tMax);
      let points = [{
        date: lastProdDate,
        Q: lastRate,
        phase
      }];
      const steps = 50;
      for (let i = 1; i <= steps; i++) {
        const days = (i / steps) * forecastDays;
        const t = tMax + days;
        const Q = calculateRate(Qi, b, D, t);
        points.push({
          date: new Date(lastProdDate.getTime() + days * 86400000),
          Q,
          phase
        });
      }
      out[phase] = points;
    });
    return out;
  }, [phaseParams, tMax, lastProdDate, forecastDays, localHasData]);

  // Calculate EUR and forecast averages
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
      const steps = 60;
      let sum = 0;
      for (let i = 0; i <= steps; i++) {
        const t = tMax + (i / steps) * 60;
        sum += calculateRate(Qi, b, D, t);
      }
      fa[phase] = sum / (steps + 1);
    });
    return fa;
  }, [phaseParams, tMax]);

  // Inform parent if parameters change
  useEffect(() => {
    if (!onParametersCalculated) return;
    const newParams = { phaseParams, calculatedEUR, forecastAverage };
    if (JSON.stringify(newParams) !== JSON.stringify(lastOnParamsCallRef.current)) {
      lastOnParamsCallRef.current = newParams;
      onParametersCalculated(newParams);
    }
  }, [phaseParams, calculatedEUR, forecastAverage, onParametersCalculated]);

  // Key listeners for drag adjustments
  useEffect(() => {
    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if (["d", "q", "b"].includes(key)) setActiveKey(key);
    };
    const handleKeyUp = () => {
      setActiveKey(null);
      dragStartRef.current = null;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const getAdjustmentForDrag = useCallback((key, dy, originalValue) => {
    switch (key) {
      case "d":
        return Math.max(0.0001, originalValue * (1 - dy * 0.0005));
      case "q":
        return Math.max(1, originalValue - dy * 0.5);
      case "b":
        return Math.max(0, Math.min(1, originalValue + dy * 0.002));
      default:
        return originalValue;
    }
  }, []);

  // D3 Rendering
  useEffect(() => {
    if (!localHasData || !svgRef.current) return;
    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const width = 800, height = 400;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const baseLayer = svg.append("g").attr("class", "base-layer");
    const dataLayer = svg.append("g").attr("class", "data-layer");
    const forecastLayer = svg.append("g").attr("class", "forecast-layer");
    const axisLayer = svg.append("g").attr("class", "axis-layer");
    const overlayLayer = svg.append("g").attr("class", "overlay-layer");

    baseLayer.append("rect")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", width - margin.left - margin.right)
      .attr("height", height - margin.top - margin.bottom)
      .attr("fill", "#f8f8f8")
      .attr("stroke", "#ccc");

    const allDates = [
      ...allHistoricalPoints.map(d => d.date),
      ...Object.values(allForecastPoints).flat().map(d => d.date)
    ];
    const [minDateScale, maxDateScale] = d3.extent(allDates);
    const xScale = d3.scaleTime()
      .domain([minDateScale || new Date(), maxDateScale || new Date()])
      .range([margin.left, width - margin.right]);
    xScaleRef.current = xScale;

    const allQ = [
      ...allHistoricalPoints.map(d => d.Q),
      ...Object.values(allForecastPoints).flat().map(d => d.Q)
    ];
    let [minQ, maxQ] = d3.extent(allQ);
    if (yScaleType !== "log") {
      const qRange = maxQ - minQ;
      maxQ += qRange * 0.1;
      minQ = Math.max(0, minQ - qRange * 0.05);
    } else if (minQ <= 0) {
      minQ = 0.01;
    }
    const yScale = yScaleType === "log"
      ? d3.scaleLog().domain([Math.max(0.01, minQ), maxQ]).range([height - margin.bottom, margin.top])
      : d3.scaleLinear().domain([minQ, maxQ]).range([height - margin.bottom, margin.top]);
    yScaleRef.current = yScale;

    baseLayer.append("g")
      .attr("class", "grid y-grid")
      .attr("opacity", 0.3)
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(yScale).tickSize(-(width - margin.left - margin.right)).tickFormat(""));
    baseLayer.append("g")
      .attr("class", "grid x-grid")
      .attr("opacity", 0.3)
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(xScale).tickSize(-(height - margin.top - margin.bottom)).tickFormat(""));

    Object.keys(phasesDetected).forEach(phase => {
      const pts = allHistoricalPoints.filter(p => p.phase === phase);
      dataLayer.selectAll(`circle.${phase}`)
        .data(pts)
        .enter().append("circle")
        .attr("class", phase)
        .attr("cx", d => xScale(d.date))
        .attr("cy", d => yScale(d.Q))
        .attr("r", 3)
        .attr("fill", colors[phase] || "#888");
    });

    Object.keys(phaseParams).forEach(phase => {
      if (!phaseParams[phase] || !phaseData[phase]?.length) return;
      const { Qi, b, D } = phaseParams[phase];
      const lineData = [];
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const t = tMax * frac;
        const Q = calculateRate(Qi, b, D, t);
        lineData.push({ date: new Date(firstDate.getTime() + t * 86400000), Q });
      }
      const lineGen = d3.line()
        .x(d => xScale(d.date))
        .y(d => yScale(d.Q))
        .curve(d3.curveMonotoneX);
      const declineLine = dataLayer.append("path")
        .datum(lineData)
        .attr("class", `decline-line-${phase}`)
        .attr("fill", "none")
        .attr("stroke", colors[phase] || "#888")
        .attr("stroke-width", 2)
        .attr("d", lineGen)
        .style("cursor", "pointer")
        .on("mouseover", function() {
          d3.select(this).attr("stroke-width", 4);
        })
        .on("mouseout", function() {
          if (phase !== activePhase) d3.select(this).attr("stroke-width", 2);
        });
      
      declineLine.call(d3.drag()
        .on("start", function(event) {
          if (!activeKey) return;
          setActivePhase(phase);
          dragStartRef.current = { y: event.y, params: { ...phaseParams[phase] } };
          event.sourceEvent.stopPropagation();
        })
        .on("drag", function(event) {
          if (!activeKey || !activePhase || !dragStartRef.current) return;
          const { y, params } = dragStartRef.current;
          const dy = event.y - y;
          setPhaseParams(prev => {
            const copy = { ...prev };
            if (!copy[activePhase]) return prev;
            const curr = { ...copy[activePhase] };
            if (activeKey === "d") curr.D = getAdjustmentForDrag("d", dy, params.D);
            else if (activeKey === "q") curr.Qi = getAdjustmentForDrag("q", dy, params.Qi);
            else if (activeKey === "b") curr.b = getAdjustmentForDrag("b", dy, params.b);
            copy[activePhase] = curr;
            return copy;
          });
          event.sourceEvent.stopPropagation();
        })
        .on("end", function(event) {
          dragStartRef.current = null;
          event.sourceEvent.stopPropagation();
        })
      );
    });

    Object.keys(allForecastPoints).forEach(phase => {
      const forecastPts = allForecastPoints[phase];
      if (forecastPts.length > 1) {
        const lineGen = d3.line()
          .x(d => xScale(d.date))
          .y(d => yScale(d.Q))
          .curve(d3.curveMonotoneX);
        forecastLayer.append("path")
          .datum(forecastPts)
          .attr("class", `forecast-line-${phase}`)
          .attr("fill", "none")
          .attr("stroke", d3.color(colors[phase] || "#888").brighter(1.2))
          .attr("stroke-width", 3)
          .attr("stroke-dasharray", "5,3")
          .attr("d", lineGen)
          .on("mouseover", function() { d3.select(this).attr("stroke-width", 5); })
          .on("mouseout", function() { d3.select(this).attr("stroke-width", 3); });
      }
    });

    overlayLayer.append("line")
      .attr("x1", xScale(lastProdDate))
      .attr("y1", margin.top)
      .attr("x2", xScale(lastProdDate))
      .attr("y2", height - margin.bottom)
      .attr("stroke", "#666")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "5,5");
    overlayLayer.append("text")
      .attr("x", xScale(lastProdDate) + 5)
      .attr("y", margin.top + 15)
      .attr("fill", "#666")
      .text("Forecast →");

    const xAxis = d3.axisBottom(xScale).tickFormat(d3.timeFormat("%Y-%m-%d"));
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

    const zoom = d3.zoom()
      .scaleExtent([0.5, 10])
      .on("zoom", event => {
        const newYScale = event.transform.rescaleY(yScale);
        yScaleRef.current = newYScale;
        dataLayer.selectAll("circle").attr("cy", d => newYScale(d.Q));
        dataLayer.selectAll("path").attr("d", function(d) {
          if (!Array.isArray(d)) return;
          return d3.line()
            .x(d => xScale(d.date))
            .y(d => newYScale(d.Q))
            .curve(d3.curveMonotoneX)(d);
        });
        forecastLayer.selectAll("path").attr("d", function(d) {
          if (!Array.isArray(d)) return;
          return d3.line()
            .x(d => xScale(d.date))
            .y(d => newYScale(d.Q))
            .curve(d3.curveMonotoneX)(d);
        });
        axisLayer.select("g").call(yAxis.scale(newYScale));
      });
    svg.call(zoom);
  }, [
    localHasData, allHistoricalPoints, allForecastPoints,
    phasesDetected, phaseParams, phaseData, firstDate,
    tMax, lastProdDate, yScaleType, colors, activeKey, activePhase, forecastDays,
    getAdjustmentForDrag
  ]);

  const throttledMouseMove = useThrottledMouse((event) => {
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
  }, 50);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', bottom: -45, left: 0,
        display: 'flex', gap: 20, alignItems: 'center',
        fontSize: 12, color: '#666', zIndex: 5
      }}>
        <div><strong>Key:</strong> {activeKey ? activeKey.toUpperCase() : "None"}</div>
        <div><strong>Phase:</strong> {activePhase ? activePhase.toUpperCase() : "None"}</div>
        <div><strong>Instructions:</strong> Hold D, Q, or B key and drag to adjust</div>
      </div>
      <svg
        ref={svgRef}
        width={800}
        height={400}
        onMouseMove={throttledMouseMove}
        onMouseOut={() => setHoverInfo(null)}
      />
      {hoverInfo && (
        <div style={{
          position: 'absolute', left: hoverInfo.x + 5, top: 0,
          pointerEvents: 'none', background: 'rgba(255,255,255,0.9)',
          border: '1px solid #ccc', padding: 5, fontSize: 12,
          borderRadius: 4, zIndex: 1000
        }}>
          <div>{hoverInfo.date.toDateString()}</div>
          {Object.keys(hoverInfo.values).map(ph => (
            <div key={ph}>{ph.toUpperCase()}: {hoverInfo.values[ph].toFixed(2)}</div>
          ))}
        </div>
      )}
    </div>
  );
});

export default InteractiveDCAChart;
