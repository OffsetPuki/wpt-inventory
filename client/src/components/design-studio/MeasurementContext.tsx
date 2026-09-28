import {createContext,useContext} from 'react';
import type {Unit} from './fractions';
export const MeasurementContext=createContext<Unit>('fraction');
export const useUnit=()=>useContext(MeasurementContext);
