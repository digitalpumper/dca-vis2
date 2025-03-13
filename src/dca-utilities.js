/**
 * DCA (Decline Curve Analysis) Utilities
 * 
 * This module contains utility functions for decline curve analysis
 * commonly used in oil and gas production forecasting.
 */

/**
 * Calculate production rate at time t using Arps decline curve model
 * @param {number} Qi - Initial rate
 * @param {number} b - Decline exponent (0 = exponential, 1 = harmonic)
 * @param {number} D - Initial decline rate, fraction per unit time
 * @param {number} t - Time, typically in days
 * @returns {number} Production rate at time t
 */
export const calculateRate = (Qi, b, D, t) => {
    if (b === 0) {
      return Qi * Math.exp(-D * t);
    }
    return Qi / Math.pow(1 + b * D * t, 1 / b);
  };
  
  /**
   * Calculate cumulative production (EUR) from decline curve parameters
   * @param {number} Qi - Initial rate
   * @param {number} b - Decline exponent (0 = exponential, 1 = harmonic)
   * @param {number} D - Initial decline rate, fraction per unit time
   * @param {number} t - Time limit for EUR calculation, typically in days
   * @returns {number} Estimated ultimate recovery up to time t
   */
  export const calculateEUR = (Qi, b, D, t = Infinity) => {
    if (!Qi || D <= 0) {
      return 0;
    }
    
    // Handle special cases based on b value
    if (b === 0) {
      // Exponential decline with time limit
      if (t < Infinity) {
        return (Qi / D) * (1 - Math.exp(-D * t));
      }
      return Qi / D;
    } 
    else if (b === 1) {
      // Harmonic decline with time limit
      if (t < Infinity) {
        return (Qi / D) * Math.log(1 + D * t);
      }
      return Infinity; // Infinite EUR for harmonic decline
    }
    else if (b > 0 && b < 1) {
      // Hyperbolic decline with time limit
      if (t < Infinity) {
        return (Qi / (D * (1 - b))) * (1 - Math.pow(1 + b * D * t, (1 - b) / b));
      }
      return Qi / (D * (1 - b));
    }
    
    return 0; // Invalid b value
  };
  
  /**
   * Calculate 60-day average production from decline curve parameters
   * @param {number} Qi - Initial rate
   * @param {number} b - Decline exponent
   * @param {number} D - Initial decline rate
   * @param {number} t - Starting time for average calculation
   * @returns {number} 60-day average production
   */
  export const calculate60DayAverage = (Qi, b, D, t) => {
    if (!Qi || D <= 0) {
      return 0;
    }
    
    // Calculate average using numerical integration (trapezoidal rule)
    const days = 60;
    const steps = 20; // Number of steps for integration
    const dt = days / steps;
    
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const time = t + i * dt;
      const rate = calculateRate(Qi, b, D, time);
      
      // Trapezoidal rule weights
      const weight = (i === 0 || i === steps) ? 0.5 : 1.0;
      sum += weight * rate;
    }
    
    return sum * dt / days;
  };
  
  /**
   * Helper function to calculate error between actual data points and the decline curve model
   * @param {Array} points - Array of {t, value} points
   * @param {Object} params - Decline curve parameters {Qi, b, D}
   * @returns {number} Sum of squared errors
   */
  export const calculateError = (points, params) => {
    const { Qi, b, D } = params;
    
    let sumSquaredError = 0;
    for (const point of points) {
      const predicted = calculateRate(Qi, b, D, point.t);
      const error = Math.pow(predicted - point.value, 2);
      sumSquaredError += error;
    }
    
    return sumSquaredError / points.length;
  };
  
  /**
   * Simplified decline parameter estimation
   * @param {Array} points - Array of {t, value} time-series data points
   * @returns {Object} - Estimated decline parameters {Qi, b, D}
   */
  export const estimateDeclineParams = (points) => {
    if (!points || points.length < 3) {
      return { Qi: points?.[0]?.value || 100, b: 0.5, D: 0.05 };
    }
    
    const sorted = [...points].sort((a, b) => a.t - b.t);
    const Qi = sorted[0].value;
    const last = sorted[sorted.length - 1];
    
    // Default b value
    const b = 0.5;
    
    // Simple D calculation
    const ratio = last.value / Qi;
    const t = last.t;
    
    // Calculate D based on decline between first and last points
    const D = Math.max(0.001, Math.min(0.5, (1 - ratio) / (t * (1 - b))));
    
    return { Qi, b, D };
  };
  
  /**
   * More sophisticated algorithm to fit decline curve parameters to historical data
   * Uses least squares optimization with a grid search approach
   * 
   * @param {Array} dataPoints - Array of {t, value} points
   * @param {Object} initialGuess - Initial parameter guesses {Qi, b, D}
   * @returns {Object} Best fit parameters {Qi, b, D, error}
   */
  export const fitDeclineCurve = (dataPoints, initialGuess = {}) => {
    if (!dataPoints || dataPoints.length < 3) {
      return { Qi: 100, b: 0.5, D: 0.05, error: Infinity };
    }
    
    // Sort points by time
    const points = [...dataPoints].sort((a, b) => a.t - b.t);
    
    // Default initial guess
    const guess = {
      Qi: initialGuess.Qi || points[0].value,
      b: initialGuess.b ?? 0.5,
      D: initialGuess.D ?? 0.05
    };
    
    let bestParams = { ...guess };
    let bestError = calculateError(points, bestParams);
    
    // Try different b values to find the best fit
    const bValues = [0, 0.3, 0.5, 0.7, 0.9];
    
    bValues.forEach(b => {
      // Optimize D for this b value
      let minD = 0.001;
      let maxD = 0.5;
      let bestD = 0.05;
      let bestDError = Infinity;
      
      // Simple grid search for D
      for (let i = 0; i <= 10; i++) {
        const D = minD + (i / 10) * (maxD - minD);
        
        // Try adjusting Qi slightly
        for (let qiPct = 0.9; qiPct <= 1.1; qiPct += 0.05) {
          const Qi = guess.Qi * qiPct;
          const params = { Qi, b, D };
          const error = calculateError(points, params);
          
          if (error < bestDError) {
            bestDError = error;
            bestD = D;
          }
          
          if (error < bestError) {
            bestParams = { Qi, b, D };
            bestError = error;
          }
        }
      }
    });
    
    return { ...bestParams, error: bestError };
  };
  
  /**
   * Export decline curve results to CSV format
   * @param {Object} phaseParams - Parameters for each phase
   * @param {Object} calculatedEUR - EUR for each phase
   * @param {Object} forecastAverage - 60-day averages for each phase
   * @returns {string} CSV formatted string with results
   */
  export const exportResultsToCSV = (phaseParams, calculatedEUR, forecastAverage) => {
    const phases = Object.keys(phaseParams);
    
    // CSV header
    let csv = "Phase,Qi,b,D,EUR,60-Day Avg\n";
    
    // Add data for each phase
    phases.forEach(phase => {
      const { Qi, b, D } = phaseParams[phase];
      const eur = calculatedEUR[phase];
      const avg = forecastAverage[phase];
      
      csv += `${phase},${Qi.toFixed(2)},${b.toFixed(3)},${D.toFixed(5)},${typeof eur === 'number' ? eur.toFixed(0) : eur},${avg.toFixed(2)}\n`;
    });
    
    return csv;
  };
  
  /**
   * Helper for drag adjustments to decline parameters
   * @param {string} key - Parameter to adjust (d, q, or b)
   * @param {number} dy - Change in y position
   * @param {number} originalValue - Original parameter value
   * @returns {number} Adjusted parameter value
   */
  export const getAdjustmentForDrag = (key, dy, originalValue) => {
    switch (key) {
      case "d":
        // Very fine control for D parameter
        return Math.max(0.0001, originalValue * (1 - dy * 0.0005));
      case "q":
        // Linear change for Qi
        return Math.max(1, originalValue - dy * 0.5);
      case "b":
        // Fine control for b with range limiting
        return Math.max(0, Math.min(1, originalValue + dy * 0.002));
      default:
        return originalValue;
    }
  };
  
  /**
   * Calculate Percentage Error between forecast and actuals
   * @param {Array} actuals - Array of actual values
   * @param {Array} forecast - Array of forecast values
   * @returns {number} Percentage error
   */
  export const calculatePercentageError = (actuals, forecast) => {
    if (!actuals || !forecast || actuals.length !== forecast.length) {
      return Infinity;
    }
    
    let sumPercentError = 0;
    let count = 0;
    
    for (let i = 0; i < actuals.length; i++) {
      if (actuals[i] > 0) {
        const percentError = Math.abs((forecast[i] - actuals[i]) / actuals[i]) * 100;
        sumPercentError += percentError;
        count++;
      }
    }
    
    return count > 0 ? sumPercentError / count : Infinity;
  };
  
  /**
   * Calculate volume-weighted average decline rate
   * @param {Array} rates - Array of rates
   * @param {Array} volumes - Array of volumes
   * @returns {number} Volume-weighted average
   */
  export const calculateVolumeWeightedAverage = (rates, volumes) => {
    if (!rates || !volumes || rates.length !== volumes.length) {
      return 0;
    }
    
    let sumProducts = 0;
    let sumVolumes = 0;
    
    for (let i = 0; i < rates.length; i++) {
      sumProducts += rates[i] * volumes[i];
      sumVolumes += volumes[i];
    }
    
    return sumVolumes > 0 ? sumProducts / sumVolumes : 0;
  };
  
  /**
   * Helper function to detect date column in CSV headers
   * @param {Array} headers - Array of CSV column headers
   * @returns {string} Best matching date column name
   */
  export const detectDateColumn = (headers) => {
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
  };
  
  /**
   * Helper function to detect production columns in CSV headers
   * @param {Array} headers - Array of CSV column headers
   * @returns {Object} Mapping of phase names to column headers
   */
  export const detectColumns = (headers) => {
    let phases = {};
    headers.forEach(header => {
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
  };
  
  /**
   * Calculate 30-day, 60-day, 90-day, and 180-day decline rates
   * @param {Object} params - Decline curve parameters {Qi, b, D}
   * @param {number} startTime - Starting time for calculation
   * @returns {Object} Calculated decline rates for different periods
   */
  export const calculateDeclineRates = (params, startTime = 0) => {
    const { Qi, b, D } = params;
    
    if (!Qi || D <= 0) {
      return {
        day30: 0,
        day60: 0,
        day90: 0,
        day180: 0
      };
    }
    
    const initialRate = calculateRate(Qi, b, D, startTime);
    
    const rate30 = calculateRate(Qi, b, D, startTime + 30);
    const rate60 = calculateRate(Qi, b, D, startTime + 60);
    const rate90 = calculateRate(Qi, b, D, startTime + 90);
    const rate180 = calculateRate(Qi, b, D, startTime + 180);
    
    return {
      day30: (initialRate - rate30) / initialRate,
      day60: (initialRate - rate60) / initialRate,
      day90: (initialRate - rate90) / initialRate,
      day180: (initialRate - rate180) / initialRate
    };
  };
  
  /**
   * Generate a type curve from multiple wells
   * @param {Array} wells - Array of well data objects
   * @returns {Object} Generated type curve
   */
  export const generateTypeCurve = (wells) => {
    if (!wells || wells.length === 0) {
      return { Qi: 100, b: 0.5, D: 0.05 };
    }
    
    // Normalize all wells to day 0
    const normalizedData = [];
    
    wells.forEach(well => {
      const wellData = [...well.data].sort((a, b) => a.t - b.t);
      
      if (wellData.length > 0) {
        const firstDay = wellData[0].t;
        const normalized = wellData.map(point => ({
          t: point.t - firstDay,
          value: point.value
        }));
        
        normalizedData.push(...normalized);
      }
    });
    
    // Fit a single curve to all normalized data
    return fitDeclineCurve(normalizedData);
  };
  
  // Export all utilities
  export default {
    calculateRate,
    calculateEUR,
    calculate60DayAverage,
    calculateError,
    estimateDeclineParams,
    fitDeclineCurve,
    exportResultsToCSV,
    getAdjustmentForDrag,
    calculatePercentageError,
    calculateVolumeWeightedAverage,
    detectDateColumn,
    detectColumns,
    calculateDeclineRates,
    generateTypeCurve
  };