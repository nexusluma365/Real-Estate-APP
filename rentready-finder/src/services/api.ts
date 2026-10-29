import type { LocationSuggestion, Property, SearchFilters } from '../types/property';
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/finder/api';
export const LIVE_DATA_ENABLED = true;
export class ServiceNotConnectedError extends Error { constructor(message: string) { super(message); this.name='ServiceNotConnectedError'; } }
export interface SearchResponse { location:{label:string;lat:number;lng:number};properties:Property[];nextPageToken:string|null;unsupportedFilters:{filter:keyof SearchFilters;reason:string}[]; }
async function request<T>(path:string,options:RequestInit={},signal?:AbortSignal):Promise<T>{const r=await fetch(`${API_BASE}/${path}`,{...options,signal});const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to load apartments');return data as T;}
export function autocompleteLocation(input:string,signal?:AbortSignal):Promise<LocationSuggestion[]>{return request(`locations/autocomplete?q=${encodeURIComponent(input)}`,{},signal);}
export function searchProperties(query:{text?:string;placeId?:string;coords?:{lat:number;lng:number}},filters:SearchFilters,signal?:AbortSignal):Promise<SearchResponse>{return request('properties/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,filters})},signal);}
export function getPropertyDetails(placeId:string,signal?:AbortSignal):Promise<Property>{return request(`properties/${encodeURIComponent(placeId)}`,{},signal);}
export function getFeaturedProperties(city:string,signal?:AbortSignal):Promise<Property[]>{return request(`properties/featured?city=${encodeURIComponent(city)}`,{},signal);}
export function photoUrl(photoName:string,maxWidth=900):string{return `${API_BASE}/photos?name=${encodeURIComponent(photoName)}&maxWidthPx=${maxWidth}`;}
export function directionsUrl(p:Pick<Property,'name'|'formattedAddress'|'placeId'>):string{return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.name}, ${p.formattedAddress}`)}&destination_place_id=${encodeURIComponent(p.placeId)}`;}
export function telHref(phone:string):string{return `tel:${phone.replace(/[^\d+]/g,'')}`;}
