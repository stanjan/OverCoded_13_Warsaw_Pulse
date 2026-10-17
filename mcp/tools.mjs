import { catalogProvider, matches, coordinates, locate } from './catalog.mjs';
import { SOURCES } from './sources.mjs';
const bounds = { type: 'object', properties: Object.fromEntries(['south','west','north','east'].map(k => [k,{type:'number'}])), required: ['south','west','north','east'], additionalProperties:false };
export const filtersSchema = { query:{type:'string'}, category:{type:'string',enum:Object.keys(SOURCES)}, district:{type:'string'}, activity:{type:'string'}, audience:{type:'string'}, weekday:{type:'string',enum:['Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota','Niedziela']}, dateFrom:{type:'string'}, dateTo:{type:'string'}, bounds, maxLengthKm:{type:'number',minimum:0} };
const schema = (properties, required=[]) => ({type:'object', properties, required, additionalProperties:false});
export const mcpTools = [
 {name:'list_data_sources',description:'Opisz dostępne kategorie miejskich danych i obsługiwane filtry, bez pobierania rekordów. Użyj dla pytań typu „jakie dane masz dostępne?”, „co możesz pokazać?” lub o możliwości aplikacji. Nie potwierdza aktualnej dostępności źródeł.',inputSchema:schema({})},
 {name:'search_places',description:'Pobierz WSZYSTKIE pasujące dane z miejskiego MCP. Kategorie: event wydarzenia, sports zajęcia, weather pomiary pogody, pitch boiska, route trasy, air_quality pomiary powietrza. Filtry wyłącznie ze znanych preferencji rozmowy. Bez limitu wyników. complete=false oznacza niedostępne źródło, nigdy pusty katalog. Daty ISO YYYY-MM-DD: rekordy bez dat wykluczone; do cyklicznych zajęć użyj weekday. Pogoda nie jest prognozą. Otwarte boiska to nazwa zbioru, godziny wymagają sprawdzenia.',inputSchema:schema(filtersSchema)},
 {name:'filter_results',description:'Zawęź ostatnie wyniki na podstawie kontekstu rozmowy. Nie pobiera nowych danych. Brakujące cechy nie spełniają filtra.',inputSchema:schema(filtersSchema)},
 {name:'display_results',description:'Wyświetl WSZYSTKIE wybrane trafne rekordy z wyszukiwania i 1–3 najlepsze rekomendacje. Przekaż identyfikatory; treści pochodzą wyłącznie z wyników MCP. highlightIds muszą należeć do ids. Następnie odpowiedz po polsku w 1–3 krótkich zdaniach.',inputSchema:schema({ids:{type:'array',items:{type:'string'}},highlightIds:{type:'array',items:{type:'string'},maxItems:3},title:{type:'string',maxLength:100}},['ids','highlightIds','title'])},
 {name:'focus_map',description:'Ustaw widok mapy; nie dodaje rekordów.',inputSchema:schema({latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180},zoom:{type:'integer',minimum:10,maximum:18}},['latitude','longitude','zoom'])},
];
export function validate(value, rule) {
 if (rule.type === 'object') {
   if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!Object.hasOwn(rule.properties,k)) || (rule.required||[]).some(k=>!Object.hasOwn(value,k))) throw new Error('Nieprawidłowe parametry.');
   for (const [k,v] of Object.entries(value)) validate(v,rule.properties[k]);
 } else if (rule.type==='array') {
   if (!Array.isArray(value) || value.length > (rule.maxItems??Infinity)) throw new Error('Nieprawidłowa lista.');
   value.forEach(v=>validate(v,rule.items));
 } else if(rule.type==='string') {
   if(typeof value!=='string' || value.length>(rule.maxLength??500) || (rule.enum&&!rule.enum.includes(value))) throw new Error('Nieprawidłowy tekst.');
 } else if(typeof value!=='number'||!Number.isFinite(value)||(rule.type==='integer'&&!Number.isInteger(value))||value<(rule.minimum??-Infinity)||value>(rule.maximum??Infinity)) throw new Error('Nieprawidłowa liczba.');
}
function validateFilters(args) {
 if(args.bounds){const b=args.bounds;if(!coordinates(b.south,b.west)||!coordinates(b.north,b.east)||b.south>b.north||b.west>b.east)throw new Error('Nieprawidłowe granice mapy.');}
 for(const key of ['dateFrom','dateTo'])if(args[key]!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(args[key])||new Date(args[key]).toISOString().slice(0,10)!==args[key]))throw new Error('Nieprawidłowa data.');
 if(args.dateFrom&&args.dateTo&&args.dateFrom>args.dateTo)throw new Error('Nieprawidłowy zakres dat.');
}
export async function runTool(name,args,state,provider=catalogProvider) {
 const tool=mcpTools.find(t=>t.name===name);
 if(!tool)throw new Error('Nieznane narzędzie.');
 validate(args,tool.inputSchema);
 if(name==='list_data_sources')return {
   sources:Object.entries(SOURCES).map(([category,source])=>({category,title:source.title})),
   filters:Object.keys(filtersSchema),
   limitations:['Opis skonfigurowanych źródeł; ich dostępność i liczba rekordów są sprawdzane dopiero podczas wyszukiwania.','Pogoda oznacza pomiary stacji, nie prognozę; świeżość pomiarów wymaga sprawdzenia.','Zajęcia sportowe mogą mieć dni tygodnia bez konkretnych dat.','Nazwa Otwarte boiska nie potwierdza, że obiekt jest teraz otwarty.','Nie wszystkie rekordy mają współrzędne; można pokazać je na liście bez pinezki.'],
 };
 if(name==='search_places'||name==='filter_results')validateFilters(args);
 if(name==='search_places'){
   // Clear selection on failure so old results cannot masquerade as a fresh search.
   state.results=[];
   state.searchMeta={dataMode:'official',complete:false,total:0,errors:[{code:'SOURCE_UNAVAILABLE'}]};
   const response=await provider.search(args);
   const envelope=Array.isArray(response)?{results:response,total:response.length,complete:true,dataMode:'test',sources:[],errors:[]}:response;
   if(!envelope||!Array.isArray(envelope.results))throw new Error('Nieprawidłowa odpowiedź źródła.');
   state.results=envelope.results;state.searchMeta={...envelope,results:undefined};
   return envelope;
 }
 if(name==='filter_results'){
   if(!state.searchMeta)throw new Error('Najpierw wyszukaj rekordy.');
   state.results=state.results.filter(p=>matches(p,args)).map(p=>locate(p,args));
   return {...state.searchMeta,results:state.results,total:state.results.length};
 }
 if(name==='display_results'){
   if(!state.searchMeta)throw new Error('Najpierw wyszukaj rekordy.');
   const ids=[...new Set(args.ids)],highlights=[...new Set(args.highlightIds)];
   if(ids.length!==args.ids.length||highlights.length!==args.highlightIds.length||highlights.some(id=>!ids.includes(id))||(ids.length&&highlights.length<1)||(!ids.length&&highlights.length))throw new Error('Wybierz 1–3 unikalne rekomendacje spośród wyników.');
   const byId=new Map(state.results.map(p=>[p.id,p]));
   if(ids.some(id=>!byId.has(id)))throw new Error('Najpierw wyszukaj wskazane rekordy.');
   const results=ids.map(id=>byId.get(id));
   const action={type:'display_results',title:args.title,results,highlightIds:highlights,highlights:highlights.map(id=>byId.get(id)),dataMode:state.searchMeta?.dataMode||'official',complete:state.searchMeta?.complete??true,errors:state.searchMeta?.errors||[]};
   state.actions.push(action);
   return {displayed:results.length,highlightIds:highlights,action};
 }
 state.actions.push({type:'focus_map',...args});return{focused:true};
}
