import React from 'react';

const LoadingBar = ({ progress }) => {
  return (
    <div className="loading-container">
      <div className="loading-bar" style={{ width: `${progress}%` }}></div>
    </div>
  );
};

export default LoadingBar;
