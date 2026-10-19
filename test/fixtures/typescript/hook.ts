import { useState } from 'react';
const fs = require('fs');

export const useCounter = (start = 0) => {
  const [count, setCount] = useState(start);
  return { count, increment: () => setCount(count + 1) };
};

export const MAX = 10, MIN = 0;

export default class Store {
  items: string[] = [];
}

abstract class Base {}
export abstract class Shape extends Base {}
