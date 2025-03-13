// src/DualRangeSlider.jsx
import React from 'react';
import { Range } from 'react-range';

const DualRangeSlider = ({ min, max, values, onChange, tipFormatter }) => {
  return (
    <Range
      step={1}
      min={min}
      max={max}
      values={values}
      onChange={onChange}
      renderTrack={({ props, children }) => (
        <div
          {...props}
          style={{
            ...props.style,
            height: '6px',
            background: '#ddd',
            margin: '10px 0'
          }}
        >
          {children}
        </div>
      )}
      renderThumb={({ props, index, isDragged }) => {
        // Destructure "key" to avoid spreading it
        const { key, ...rest } = props;
        return (
          <div
            key={key}
            {...rest}
            style={{
              ...rest.style,
              height: '20px',
              width: '20px',
              borderRadius: '50%',
              backgroundColor: isDragged ? '#548BF4' : '#CCC',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '-28px',
                color: '#000',
                fontWeight: 'bold',
                fontSize: '12px'
              }}
            >
              {tipFormatter ? tipFormatter(values[index]) : values[index]}
            </div>
          </div>
        );
      }}
    />
  );
};

export default DualRangeSlider;
