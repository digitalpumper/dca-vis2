// src/InteractiveDCAChart.js
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { calculateRate, detectDateColumn, detectColumns } from './dca';

// Throttled mouse move hook for tooltips.
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
  const zoomTransformRef = useRef(d3.zoomIdentity);
  // We'll store the drag start info here so that the drag is relative to domain space.
  const dragStartRef = useRef(null);

  // Active key: "d" or "b" if pressed; otherwise we adjust Q by default.
  const [activeKey, setActiveKey] = useState(null);
  // Auto‑fit on by default; disable after first drag.
  const [autoFitEnabled, setAutoFitEnabled] = useState(true);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [phaseParams, setPhaseParams] = useState({});
  const prevParamsRef = useRef({});
  const lastOnParamsCallRef = useRef(null);

  // Chart dims
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = 800, height = 400;
  
  //** Sensitivity factors ** for domain-based changes. 
  // We'll apply a multiplier to the domain difference for D and b,
  // so they don't move too drastically with a small vertical drag.
  const dSensitivity = 0.05;  // Reduced from 1 to 0.05
  const bSensitivity = 0.05;  // Reduced from 1 to 0.05
  // For Q, we'll set a proportional factor instead of 1:1
  const qSensitivity = 0.8;   // Added proportional factor for Q

  // Key listeners
  useEffect(() => {
    const handleKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'd' || k === 'b') {
        setActiveKey(k);
      }
    };
    const handleKeyUp = () => {
      setActiveKey(null);
      dragStartRef.current = null;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Parse CSV
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

  // Filter
  const filteredData = useMemo(() => {
    if (!hasData) return [];
    let arr = parsedData.map(row => ({
      ...row,
      [prodDateCol]: new Date(row[prodDateCol])
    })).filter(row => !isNaN(row[prodDateCol].getTime()));
    arr.sort((a, b) => a[prodDateCol] - b[prodDateCol]);
    if (startDate) {
      const sd = new Date(startDate);
      arr = arr.filter(r => r[prodDateCol] >= sd);
    }
    if (endDate) {
      const ed = new Date(endDate);
      arr = arr.filter(r => r[prodDateCol] <= ed);
    }
    return arr;
  }, [hasData, parsedData, startDate, endDate, prodDateCol]);

  const localHasData = filteredData.length > 0;
  const firstDate = useMemo(() => 
    localHasData ? filteredData[0][prodDateCol] : new Date(), 
    [localHasData, filteredData, prodDateCol]
  );
  const data = useMemo(() => {
    if (!localHasData) return [];
    return filteredData.map(row => ({
      ...row,
      t: (row[prodDateCol] - firstDate) / 86400000
    }));
  }, [filteredData, localHasData, firstDate, prodDateCol]);

  // Build phase data
  const phaseData = useMemo(() => {
    let out = {};
    Object.keys(phasesDetected).forEach(phase => {
      out[phase] = data.map(d => ({
        t: d.t,
        value: +d[phasesDetected[phase]]
      })).filter(x => !isNaN(x.value));
    });
    return out;
  }, [data, phasesDetected]);

  const tMax = useMemo(() => localHasData ? d3.max(data, d => d.t) : 0, [data, localHasData]);
  const lastProdDate = useMemo(() =>
    localHasData ? d3.max(data, d => d[prodDateCol]) : new Date(),
    [data, localHasData, prodDateCol]
  );

  // Auto-fit
  useEffect(() => {
    if (!localHasData || !autoFitEnabled) return;
    let newP = {};
    Object.keys(phaseData).forEach(phase => {
      const pts = phaseData[phase];
      if (pts.length < 3) {
        newP[phase] = { Qi: pts?.[0]?.value || 100, b: 0.5, D: 0.05 };
      } else {
        const f = pts[0], l = pts[pts.length - 1];
        const Qi = f.value;
        const b = 0.5;
        const ratio = l.value / f.value;
        const dt = l.t - f.t;
        let D = (b === 0) 
          ? -Math.log(ratio)/dt 
          : ( (1/ratio)**b -1)/(b*dt);
        D = Math.max(0.001, Math.min(0.5, D));
        newP[phase] = { Qi, b, D };
      }
    });
    if (JSON.stringify(newP) !== JSON.stringify(prevParamsRef.current)) {
      prevParamsRef.current = newP;
      setPhaseParams(newP);
    }
  }, [phaseData, localHasData, autoFitEnabled]);

  // Plot points
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

  // Forecast
  const allForecastPoints = useMemo(() => {
    if (!localHasData) return {};
    let out = {};
    Object.keys(phaseParams).forEach(phase => {
      const { Qi, b, D } = phaseParams[phase]||{};
      if (!Qi || D<=0) {
        out[phase] = [];
        return;
      }
      const lastRate = calculateRate(Qi, b, D, tMax);
      let pts = [{ date: lastProdDate, Q: lastRate, phase }];
      const steps = 50;
      for (let i=1; i<=steps; i++){
        const days = (i/steps)*forecastDays;
        const t = tMax + days;
        const Q = calculateRate(Qi,b,D,t);
        pts.push({
          date: new Date(lastProdDate.getTime() + days*86400000),
          Q,
          phase
        });
      }
      out[phase] = pts;
    });
    return out;
  }, [phaseParams, tMax, lastProdDate, forecastDays, localHasData]);

  // EUR & forecast avg
  const calculatedEUR = useMemo(() => {
    let r = {};
    Object.keys(phaseParams).forEach(phase => {
      const { Qi, b, D } = phaseParams[phase] || {};
      if (!Qi || D<=0) {
        r[phase] = "N/A";
        return;
      }
      if (b===0) r[phase] = Qi/D;
      else if (b>0&& b<1) r[phase] = Qi/(D*(1-b));
      else if(b===1) r[phase] = Qi*10000;
      else r[phase] = "N/A";
    });
    return r;
  }, [phaseParams]);

  const forecastAverage = useMemo(() => {
    let r = {};
    Object.keys(phaseParams).forEach(phase => {
      const {Qi,b,D} = phaseParams[phase]||{};
      if(!Qi||D<=0){
        r[phase] =0;
        return;
      }
      let sum=0, steps=60;
      for(let i=0;i<=steps;i++){
        const t = tMax + (i/steps)*60;
        sum += calculateRate(Qi,b,D,t);
      }
      r[phase]= sum/(steps+1);
    });
    return r;
  }, [phaseParams, tMax]);

  // Notify parent
  useEffect(() => {
    if(!onParametersCalculated) return;
    const newParams = {phaseParams, calculatedEUR, forecastAverage};
    if(JSON.stringify(newParams)!== JSON.stringify(lastOnParamsCallRef.current)){
      lastOnParamsCallRef.current = newParams;
      onParametersCalculated(newParams);
    }
  },[phaseParams, calculatedEUR, forecastAverage,onParametersCalculated]);

  // D3 effect
  useEffect(()=>{
    if(!localHasData || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const baseLayer = svg.append("g").attr("class","base-layer");
    const dataLayer = svg.append("g").attr("class","data-layer");
    const forecastLayer = svg.append("g").attr("class","forecast-layer");
    const axisLayer = svg.append("g").attr("class","axis-layer");
    const overlayLayer = svg.append("g").attr("class","overlay-layer");
    
    // background
    baseLayer.append("rect")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", width-margin.left-margin.right)
      .attr("height", height-margin.top-margin.bottom)
      .attr("fill","#f8f8f8")
      .attr("stroke","#ccc");

    // X scale
    const allDates = [
      ...allHistoricalPoints.map(d=>d.date),
      ...Object.values(allForecastPoints).flat().map(d=>d.date)
    ];
    const [minDate,maxDate] = d3.extent(allDates);
    const xScale = d3.scaleTime()
      .domain([minDate|| new Date(), maxDate|| new Date()])
      .range([margin.left, width-margin.right]);
    xScaleRef.current = xScale;

    // Y scale
    const allQ = [
      ...allHistoricalPoints.map(d=>d.Q),
      ...Object.values(allForecastPoints).flat().map(d=>d.Q)
    ];
    let [minQ,maxQ] = d3.extent(allQ);
    if(yScaleType!=="log"){
      const qRange = maxQ- minQ;
      maxQ += qRange*0.1;
      minQ = Math.max(0, minQ - qRange*0.05);
    } else if(minQ<=0){
      minQ=0.01;
    }
    const yScale = yScaleType==="log"?
      d3.scaleLog().domain([Math.max(0.01,minQ),maxQ]).range([height-margin.bottom, margin.top]):
      d3.scaleLinear().domain([minQ,maxQ]).range([height-margin.bottom, margin.top]);
    yScaleRef.current = yScale;

    // Grid
    baseLayer.append("g").attr("class","grid y-grid")
      .attr("opacity",0.3)
      .attr("transform",`translate(${margin.left},0)`)
      .call(d3.axisLeft(yScale).tickSize(-(width-margin.left-margin.right)).tickFormat(""));
    baseLayer.append("g").attr("class","grid x-grid")
      .attr("opacity",0.3)
      .attr("transform",`translate(0,${height-margin.bottom})`)
      .call(d3.axisBottom(xScale).tickSize(-(height-margin.top-margin.bottom)).tickFormat(""));

    // Plot historical
    Object.keys(phasesDetected).forEach(phase=>{
      const pts = allHistoricalPoints.filter(x=>x.phase===phase);
      dataLayer.selectAll(`circle.${phase}`)
        .data(pts)
        .enter().append("circle")
        .attr("class", phase)
        .attr("cx", d=> xScale(d.date))
        .attr("cy", d=> yScale(d.Q))
        .attr("r", 3)
        .attr("fill", colors[phase]||"#888");
    });

    // Draw decline lines
    Object.keys(phaseParams).forEach(phase=>{
      if(!phaseParams[phase]||!phaseData[phase]?.length) return;
      const {Qi,b,D} = phaseParams[phase];
      const steps=100;
      let lineData=[];
      for(let i=0;i<=steps;i++){
        const frac = i/steps;
        const t= tMax*frac;
        const Q= calculateRate(Qi,b,D,t);
        lineData.push({
          date: new Date(firstDate.getTime()+ t*86400000),
          Q
        });
      }
      const lineGen = d3.line()
        .x(d=> xScale(d.date))
        .y(d=> yScale(d.Q))
        .curve(d3.curveMonotoneX);
      const path = dataLayer.append("path")
        .datum(lineData)
        .attr("class",`decline-line-${phase}`)
        .attr("fill","none")
        .attr("stroke", colors[phase]||"#888")
        .attr("stroke-width",2)
        .attr("d", lineGen)
        .style("cursor","pointer")
        .on("mouseover",()=> path.attr("stroke-width",4))
        .on("mouseout",()=>path.attr("stroke-width",2));

      // Attach domain-based drag
      path.call(d3.drag()
        .on("start",(evt)=>{
          // disable autofit
          setAutoFitEnabled(false);

          // which param?
          const paramType = activeKey ? activeKey : "q";
          // store domain-based start
          dragStartRef.current = {
            paramType,
            initial: {...phaseParams[phase]},
            startY: evt.y,
            startDomainY: yScale.invert(evt.y)
          };
          evt.sourceEvent.stopPropagation();
        })
        .on("drag",(evt)=>{
          if(!dragStartRef.current) return;
          const {paramType, initial, startY, startDomainY} = dragStartRef.current;
          
          // Calculate domain change as a percentage for proportional adjustment
          const currentDomainY = yScale.invert(evt.y);
          const percentageChange = (startDomainY - currentDomainY) / startDomainY;
          
          setPhaseParams(prev => {
            const copy = {...prev};
            if(!copy[phase]) return prev;

            // Modified parameter adjustment logic
            if(paramType === "q") {
              // Proportional change for Q (drag up = increase Q)
              const factor = 1 - (percentageChange * qSensitivity);
              const newQ = Math.max(0.001, initial.Qi * factor);
              copy[phase] = {...copy[phase], Qi: newQ};
            } 
            else if(paramType === "d") {
              // Inverse proportional change for D (drag up = decrease D)
              const factor = 1 + (percentageChange * dSensitivity);
              const newD = Math.max(0.001, Math.min(0.5, initial.D * factor));
              copy[phase] = {...copy[phase], D: newD};
            } 
            else if(paramType === "b") {
              if (activeKey === "b") {
                // When holding "b" key, adjust both b and D inversely
                // Adjust b inversely proportional (drag up = decrease b)
                const bFactor = 1 + (percentageChange * bSensitivity * 2);
                const newB = Math.max(0, Math.min(1, initial.b * bFactor));
                
                // Also adjust D with a similar inverse relationship
                const dFactor = 1 + (percentageChange * dSensitivity * 2);
                const newD = Math.max(0.001, Math.min(0.5, initial.D * dFactor));
                
                copy[phase] = {...copy[phase], b: newB, D: newD};
              } else {
                // Normal b adjustment (inversely proportional)
                const factor = 1 + (percentageChange * bSensitivity * 3);
                const newB = Math.max(0, Math.min(1, initial.b * factor));
                copy[phase] = {...copy[phase], b: newB};
              }
            }
            
            return copy;
          });

          evt.sourceEvent.stopPropagation();
        })
        .on("end",(evt)=>{
          dragStartRef.current = null;
          evt.sourceEvent.stopPropagation();
        })
      );
    });

    // Forecast lines
    Object.keys(allForecastPoints).forEach(phase=>{
      const pts = allForecastPoints[phase];
      if(pts.length>1){
        const lineGen= d3.line()
          .x(d=> xScale(d.date))
          .y(d=> yScale(d.Q))
          .curve(d3.curveMonotoneX);
        forecastLayer.append("path")
          .datum(pts)
          .attr("class",`forecast-line-${phase}`)
          .attr("fill","none")
          .attr("stroke", d3.color(colors[phase]||"#888").brighter(1.2))
          .attr("stroke-width",3)
          .attr("stroke-dasharray","5,3")
          .attr("d", lineGen)
          .on("mouseover", function(){ d3.select(this).attr("stroke-width",5)})
          .on("mouseout", function(){ d3.select(this).attr("stroke-width",3)});
      }
    });

    // vertical line
    overlayLayer.append("line")
      .attr("x1", xScale(lastProdDate))
      .attr("y1", margin.top)
      .attr("x2", xScale(lastProdDate))
      .attr("y2", height-margin.bottom)
      .attr("stroke","#666")
      .attr("stroke-width",1)
      .attr("stroke-dasharray","5,5");
    overlayLayer.append("text")
      .attr("x", xScale(lastProdDate)+5)
      .attr("y", margin.top+15)
      .attr("fill","#666")
      .text("Forecast →");

    // Axes
    const xAxis = d3.axisBottom(xScale).tickFormat(d3.timeFormat("%Y-%m-%d"));
    axisLayer.append("g")
      .attr("transform",`translate(0,${height-margin.bottom})`)
      .call(xAxis)
      .selectAll("text")
      .attr("transform","rotate(-45)")
      .style("text-anchor","end");
    const yAxis= yScaleType==="log"?
      d3.axisLeft(yScale).ticks(6,"~s"):
      d3.axisLeft(yScale);
    axisLayer.append("g")
      .attr("transform",`translate(${margin.left},0)`)
      .call(yAxis);
    axisLayer.append("text")
      .attr("x",width/2)
      .attr("y",height-5)
      .style("text-anchor","middle")
      .text("Date");
    axisLayer.append("text")
      .attr("transform","rotate(-90)")
      .attr("x",-height/2)
      .attr("y",15)
      .style("text-anchor","middle")
      .text("Production Rate");

    // Zoom
    const zoom= d3.zoom()
      .scaleExtent([0.5,10])
      .on("zoom",(evt)=>{
        zoomTransformRef.current= evt.transform;
        const newYScale= evt.transform.rescaleY(yScale);
        yScaleRef.current= newYScale;

        dataLayer.selectAll("circle")
          .attr("cy", d=> newYScale(d.Q));
        dataLayer.selectAll("path").attr("d", function(d){
          if(!Array.isArray(d))return;
          return d3.line()
            .x(d=> xScale(d.date))
            .y(d=> newYScale(d.Q))
            .curve(d3.curveMonotoneX)(d);
        });
        forecastLayer.selectAll("path").attr("d",function(d){
          if(!Array.isArray(d))return;
          return d3.line()
            .x(d=> xScale(d.date))
            .y(d=> newYScale(d.Q))
            .curve(d3.curveMonotoneX)(d);
        });
        axisLayer.select("g").call(yAxis.scale(newYScale));
      });
    svg.call(zoom);
  },[
    localHasData, allHistoricalPoints, allForecastPoints, phasesDetected, 
    phaseParams, phaseData, firstDate, tMax, lastProdDate, yScaleType, colors, 
    dSensitivity, bSensitivity, qSensitivity, activeKey
  ]);

  // Throttled mouse move for tooltip
  const throttledMouseMove = useThrottledMouse((event)=>{
    if(!localHasData || !xScaleRef.current || !yScaleRef.current) return;
    const [mx] = d3.pointer(event, svgRef.current);
    const date = xScaleRef.current.invert(mx);
    const t = (date - firstDate)/86400000;
    let vals = {};
    Object.keys(phaseParams).forEach(phase=>{
      const {Qi,b,D} = phaseParams[phase]||{};
      if(Qi && b!==undefined && D){
        vals[phase] = calculateRate(Qi,b,D,t);
      }
    });
    setHoverInfo({ x: mx, date, values: vals });
  }, 50);

  return (
    <div style={{ position:'relative'}}>
      {/* status bar */}
      <div style={{
        position:'absolute', bottom:-45, left:0,
        display:'flex', gap:20, alignItems:'center',
        fontSize:12, color:'#666', zIndex:5
      }}>
        <div><strong>Key:</strong> {activeKey ? activeKey.toUpperCase() : "None"}</div>
        <div><strong>Instructions:</strong> 
          Drag curve vertically to adjust parameters:
          (Default) Adjust Q proportionally,
          Hold D to adjust D inversely, 
          Hold B to adjust both B and D inversely.
          Auto-fit disabled after first drag.
        </div>
      </div>

      <svg
        ref={svgRef}
        width={width}
        height={height}
        onMouseMove={throttledMouseMove}
        onMouseOut={()=> setHoverInfo(null)}
      />
      
      {hoverInfo && (
        <div style={{
          position:'absolute', left: hoverInfo.x+5, top:0,
          pointerEvents:'none', background:'rgba(255,255,255,0.9)',
          border:'1px solid #ccc', padding:5, fontSize:12,
          borderRadius:4, zIndex:1000
        }}>
          <div>{hoverInfo.date.toDateString()}</div>
          {Object.keys(hoverInfo.values).map(ph=>(
            <div key={ph}>{ph.toUpperCase()}: {hoverInfo.values[ph].toFixed(2)}</div>
          ))}
        </div>
      )}
    </div>
  );
});

export default InteractiveDCAChart;