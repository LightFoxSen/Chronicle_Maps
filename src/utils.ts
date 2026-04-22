/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const formatDistance = (meters: number): string => {
  const abs = Math.abs(meters);
  const format = (val: number, unit: string, decimals: number = 1) => {
    const vAbs = Math.abs(val);
    if (vAbs >= 10) return `${Math.round(val)} ${unit}`;
    return `${val.toFixed(decimals).replace(/\.0$/, '')} ${unit}`;
  };

  if (abs >= 1000) {
    return format(meters / 1000, 'km');
  } else if (abs >= 1) {
    return format(meters, 'm');
  } else if (abs >= 0.01) {
    return format(meters * 100, 'cm');
  } else {
    return format(meters * 1000, 'mm', 0);
  }
};

export const getGridConfig = (zoom: number) => {
  // zoom is pixels per meter
  const targetPixels = 100;
  const rawStep = targetPixels / zoom;
  
  const exponent = Math.floor(Math.log10(rawStep));
  const mantissa = rawStep / Math.pow(10, exponent);
  
  let snappedMantissa;
  if (mantissa < 1.5) snappedMantissa = 1;
  else if (mantissa < 3.5) snappedMantissa = 2;
  else if (mantissa < 7.5) snappedMantissa = 5;
  else snappedMantissa = 10;
  
  const step = snappedMantissa * Math.pow(10, exponent);

  return {
    step,
    minorStep: step / 5, // Split into 5 for 1-2-5 scales usually
    labelThreshold: step
  };
};

export const COLORS = [
  '#F4EBD0', '#2B2D42', '#687537', '#0A0B10', '#968C46', '#101820',
  '#2196f3', '#03a6f4', '#00bcd4', '#009688', '#4caf50',
  '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800',
  '#ff5722', '#795548', '#9e9e9e', '#607d8b', '#000000'
];
