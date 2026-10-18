import { waypoint, departure, routeMode } from '../transit-core.mjs';
import { catalogProvider, matches, coordinates, locate, audienceFilterMapping } from './catalog.mjs';
import { SOURCES, SEARCH_CATEGORIES } from './sources.mjs';
import { touristHighlightIds } from './tourism.mjs';
import { addressProvider as defaultAddressProvider, addressRequest, addressQueryKey, addressWaypoint, retainedAddresses, ADDRESS_TTL_MS, ADDRESS_SOURCE } from './addresses.mjs';
const bounds = { type: 'object', properties: Object.fromEntries(['south','west','north','east'].map(k => [k,{type:'number'}])), required: ['south','west','north','east'], additionalProperties:false };
export const filtersSchema = { query:{type:'string'}, category:{type:'string',enum:SEARCH_CATEGORIES}, district:{type:'string'}, activity:{type:'string'}, audience:{type:'string',description:'Oznaczenie odbiorców ze źródła, np. Dla dzieci, Dla młodzieży i dorosłych, Dla seniorów; rodziny mapuje także na Dla dzieci z jawnym audienceFilterMapping.'}, weekday:{type:'string',enum:['Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota','Niedziela']}, dateFrom:{type:'string'}, dateTo:{type:'string'}, bounds, maxLengthKm:{type:'number',minimum:0}, paid:{type:'boolean',description:'Tylko toalety: true płatne, false bezpłatne według źródła; nieznane wykluczone.'}, accessible:{type:'boolean',description:'Tylko toalety: true dostępne dla wszystkich, false z barierami architektonicznymi według źródła; nieznane wykluczone.'}, changingTable:{type:'boolean',description:'Tylko toalety: potwierdzony przewijak (true) lub jego brak (false); nieznane wykluczone.'} };
const schema = (properties, required=[]) => ({type:'object', properties, required, additionalProperties:false});
const transitPoint = schema({latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180},label:{type:'string',maxLength:200}},['latitude','longitude']);
export const mcpTools = [
 {name:'search_addresses',description:'Znajdź numer budynku w Warszawie w oficjalnym GUGiK. Podaj ulicę i numer osobno, bez wymyślania współrzędnych. Zwraca zweryfikowane identyfikatory do plan_transit. exact_match pozwala użyć addressId; clarification_required wymaga pytania do użytkownika. Przybliżone ulice/numery nie są celem trasy: po potwierdzeniu użytkownika wyszukaj wskazany adres ponownie. Wyniki nie zastępują wydarzeń ani miejsc.',inputSchema:schema({street:{type:'string',maxLength:120},number:{type:'string',maxLength:20},city:{type:'string',enum:['Warszawa']}},['street','number'])},
 {name:'plan_transit',description:'Otwórz planowanie trasy w przeglądarce. mode=walk oznacza tylko pieszo, auto (domyślnie) porównuje pieszo i komunikację oraz poleca wcześniejszy przyjazd, transit oznacza wyraźne „tylko komunikacją”, z wykluczeniem alternatywy pieszej; zwykłe prośby o dojazd zachowują auto. Trasy piesze: do 6 km w linii prostej, wyłącznie potwierdzone ścieżki OSM/Valhalla. Cel: dokładnie jedno z destinationAddressId (dokładny wynik search_addresses), destinationId (zweryfikowane miejsce), destinationQuery (konkretny przystanek), destinationCoordinates. Start: opcjonalne originAddressId, originQuery (przystanek) lub originCoordinates; bez nich użyje ostatniej znanej lokalizacji GPS niezależnie od wieku i dokładności albo poprosi o start, gdy brak współrzędnych. Adresy najpierw sprawdź przez search_addresses. planning_requested NIE potwierdza trasy ani ETA; nie wymyślaj linii, czasu ani przystanków.',inputSchema:schema({destinationAddressId:{type:'string'},destinationId:{type:'string'},destinationQuery:{type:'string',maxLength:200},destinationCoordinates:transitPoint,originAddressId:{type:'string'},originQuery:{type:'string',maxLength:200},originCoordinates:transitPoint,mode:{type:'string',enum:['auto','walk','transit']},departureTime:{type:'string',maxLength:40}})},
 {name:'list_data_sources',description:'Opisz dostępne kategorie miejskich danych, wyszukiwanie adresów GUGiK i obsługiwane filtry, bez pobierania rekordów. Użyj dla pytań typu „jakie dane masz dostępne?”, „co możesz pokazać?” lub o możliwości aplikacji. Nie potwierdza aktualnej dostępności źródeł.',inputSchema:schema({})},
 {name:'search_places',description:'Pobierz WSZYSTKIE pasujące dane z miejskiego MCP. Przy potrzebach lub szukaniu pomysłu użyj alternatives, aby zebrać różne kategorie w jednej liście do display_results. Konkretne prośby obsługuj zwykłymi filtrami. Kategorie: event wydarzenia, sports zajęcia, pitch boiska, route trasy, toilet toalety z miejskiego katalogu (także w budynkach dostępnych publicznie), aed defibrylatory AED. Filtry wyłącznie ze znanych preferencji rozmowy. Bez limitu wyników. complete=false oznacza niedostępne źródło, nigdy pusty katalog. Daty ISO YYYY-MM-DD: rekordy bez dat wykluczone; do cyklicznych zajęć użyj weekday. Otwarte boiska to nazwa zbioru. AED: openingHours, availability i publicAccess są deklaracjami źródła, nie statusem na żywo. Źródło AED nie podaje dzielnic; użyj bounds lub zapytania o adres/obiekt, nie zgaduj dzielnicy. Godziny toalet nie potwierdzają otwarcia teraz; paid/accessible/changingTable filtrują tylko potwierdzone cechy toalet.',inputSchema:schema({...filtersSchema,alternatives:{type:'array',minItems:2,maxItems:3,items:schema(filtersSchema,['category']),description:'Inspiracje: 2–3 różne kategorie z osobnymi filtrami, np. route z maxLengthKm i event z dateFrom/dateTo. Nie łącz z filtrami najwyższego poziomu. Jedna świeża lista do wspólnego display_results; nie dokłada wyników poprzedniego pytania.'}})},
 {name:'filter_results',description:'Zawęź ostatnie wyniki na podstawie kontekstu rozmowy. Nie pobiera nowych danych. Brakujące cechy nie spełniają filtra.',inputSchema:schema(filtersSchema)},
 {name:'display_results',description:'Wyświetl WSZYSTKIE wybrane trafne rekordy z wyszukiwania i 1–3 najlepsze rekomendacje. W zestawie inspiracji rekomenduj różne kategorie, maksymalnie trzy łącznie. Limit JEDNEJ rekomendacji route dotyczy tylko kategorii tras turystycznych, nie całego mieszanego zestawu; krótko uzasadnij wybór. Wydarzenia nadal mogą mieć trzy. Przekaż identyfikatory; treści pochodzą wyłącznie z wyników MCP. highlightIds muszą należeć do ids. Następnie odpowiedz po polsku w 1–3 krótkich zdaniach.',inputSchema:schema({ids:{type:'array',items:{type:'string'}},highlightIds:{type:'array',items:{type:'string'},maxItems:3},title:{type:'string',maxLength:100}},['ids','highlightIds','title'])},
 {name:'focus_map',description:'Ustaw widok mapy; nie dodaje rekordów.',inputSchema:schema({latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180},zoom:{type:'integer',minimum:10,maximum:18}},['latitude','longitude','zoom'])},
];
export function validate(value, rule) {
 if (rule.type === 'object') {
   if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!Object.hasOwn(rule.properties,k)) || (rule.required||[]).some(k=>!Object.hasOwn(value,k))) throw new Error('Nieprawidłowe parametry.');
   for (const [k,v] of Object.entries(value)) validate(v,rule.properties[k]);
 } else if (rule.type==='array') {
   if (!Array.isArray(value) || value.length < (rule.minItems??0) || value.length > (rule.maxItems??Infinity)) throw new Error('Nieprawidłowa lista.');
   value.forEach(v=>validate(v,rule.items));
 } else if(rule.type==='string') {
   if(typeof value!=='string' || value.length>(rule.maxLength??500) || (rule.enum&&!rule.enum.includes(value))) throw new Error('Nieprawidłowy tekst.');
 } else if(rule.type==='boolean') {
   if(typeof value!=='boolean') throw new Error('Nieprawidłowa wartość logiczna.');
 } else if(typeof value!=='number'||!Number.isFinite(value)||(rule.type==='integer'&&!Number.isInteger(value))||value<(rule.minimum??-Infinity)||value>(rule.maximum??Infinity)) throw new Error('Nieprawidłowa liczba.');
}
function validateFilters(args) {
 if(args.bounds){const b=args.bounds;if(!coordinates(b.south,b.west)||!coordinates(b.north,b.east)||b.south>b.north||b.west>b.east)throw new Error('Nieprawidłowe granice mapy.');}
 for(const key of ['dateFrom','dateTo'])if(args[key]!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(args[key])||new Date(args[key]).toISOString().slice(0,10)!==args[key]))throw new Error('Nieprawidłowa data.');
 if(args.dateFrom&&args.dateTo&&args.dateFrom>args.dateTo)throw new Error('Nieprawidłowy zakres dat.');
}
export async function runTool(name,args,state,provider=catalogProvider,addressProvider=defaultAddressProvider) {
 const tool=mcpTools.find(t=>t.name===name);
 if(!tool)throw new Error('Nieznane narzędzie.');
 validate(args,tool.inputSchema);
 if(name==='search_addresses') {
   const query=addressRequest(args), key=addressQueryKey(query);
   // A failed refresh invalidates this query's former IDs, while preserving a
   // separately verified origin/destination and the independent event results.
   state.addressSearches=retainedAddresses(state).filter(set=>set.key!==key);
   const result=await addressProvider.search(query);
   state.addressSearches=[...state.addressSearches,{key,expiresAt:Date.now()+ADDRESS_TTL_MS,candidates:result.candidates}].slice(-4);
   return result;
 }
 if(name==='plan_transit') {
   if(['destinationAddressId','destinationId','destinationQuery','destinationCoordinates'].filter(key=>args[key]!==undefined).length!==1 || ['originAddressId','originQuery','originCoordinates'].filter(key=>args[key]!==undefined).length>1) throw new Error('Wskaż jeden cel i najwyżej jeden punkt startowy.');
   let destination=args.destinationCoordinates??args.destinationQuery;
   if(args.destinationAddressId!==undefined) destination=addressWaypoint(args.destinationAddressId,state);
   if(args.destinationId!==undefined) {
     const record=state.results.find(item=>item.id===args.destinationId);
     if(!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lng)) throw new Error('Wybierz wynik z potwierdzonymi współrzędnymi.');
     destination={latitude:record.lat,longitude:record.lng,label:record.name};
   }
   waypoint(destination,'cel');
   const origin=args.originAddressId!==undefined?addressWaypoint(args.originAddressId,state):args.originCoordinates??args.originQuery;
   if(origin!==undefined)waypoint(origin,'punkt startowy');
   if(args.departureTime!==undefined)departure(args.departureTime);
   routeMode(args.mode);
   const action={type:'plan_transit',destination,...(args.mode!==undefined?{mode:args.mode}:{}),...(origin!==undefined?{origin}:{}),...(args.departureTime?{departureTime:args.departureTime}:{})};
   state.actions.push(action);
   return {status:'planning_requested',message:'Zlecono otwarcie panelu dojazdu. To nie jest obliczona trasa; czasy i wskazówki pojawią się po potwierdzeniu ścieżek OpenStreetMap / Valhalla lub połączeń ZTM w przeglądarce.',action};
 }
 if(name==='list_data_sources')return {
   sources:SEARCH_CATEGORIES.map(category=>({category,title:SOURCES[category].title})),
   addressSearch:{tool:'search_addresses',source:ADDRESS_SOURCE,scope:'Warszawa, ulica i numer budynku; dokładne dopasowanie przed planowaniem ZTM'},
   filters:Object.keys(filtersSchema),
   limitations:['Opis skonfigurowanych źródeł; ich dostępność i liczba rekordów są sprawdzane dopiero podczas wyszukiwania.','Zajęcia sportowe mogą mieć dni tygodnia bez konkretnych dat.','Nazwa Otwarte boiska nie potwierdza, że obiekt jest teraz otwarty.','Toalety obejmują również budynki dostępne publicznie. Godziny, opłata, dostępność i przewijak są danymi źródłowymi, nie informacją na żywo; kwota opłaty nie jest podana.','Defibrylatory AED: opis dostępu, godziny i dostępność pochodzą ze źródła; nie potwierdzają stanu urządzenia ani dostępu teraz. Źródło nie podaje dzielnic ani czasu aktualizacji pojedynczego AED.','Nie wszystkie rekordy mają współrzędne; można pokazać je na liście bez pinezki.'],
 };
 if(name==='search_places'&&args.alternatives){
   if(Object.keys(args).length!==1||new Set(args.alternatives.map(filters=>filters.category)).size!==args.alternatives.length)throw new Error('Wskaż 2–3 różne kategorie z osobnymi filtrami.');
   args.alternatives.forEach(validateFilters);
 } else if(name==='search_places'||name==='filter_results')validateFilters(args);
 if(name==='search_places'){
   // Clear selection on failure so old results cannot masquerade as a fresh search.
   state.results=[];
   state.searchMeta={dataMode:'official',complete:false,total:0,errors:[{code:'SOURCE_UNAVAILABLE'}]};
   const normalize=response=>Array.isArray(response)?{results:response,total:response.length,complete:true,dataMode:'test',sources:[],errors:[]}:response;
   let envelope;
   // A batch is one fresh search, never a union with previous-turn selections.
   if(args.alternatives){
     const searches=[],records=new Map();
     for(const filters of args.alternatives){
       let found;
       try{found=normalize(await provider.search(filters));if(!found||!Array.isArray(found.results))throw new Error('Invalid source');}
       catch{found={results:[],total:0,complete:false,dataMode:'official',sources:[],errors:[{category:filters.category,code:'SOURCE_UNAVAILABLE'}]};}
       for(const record of found.results)records.set(record.id,record);
       const {results,...meta}=found;searches.push({filters,...meta});
     }
     envelope={results:[...records.values()],total:records.size,complete:searches.every(search=>search.complete===true),
       dataMode:searches.every(search=>search.dataMode==='test')?'test':'official',
       sources:searches.flatMap(search=>search.sources||[]),errors:searches.flatMap(search=>search.errors||[]),searches};
   }else envelope=normalize(await provider.search(args));
   if(!envelope||!Array.isArray(envelope.results))throw new Error('Nieprawidłowa odpowiedź źródła.');
   state.results=envelope.results;state.searchMeta={...envelope,results:undefined};
   return envelope;
 }
 if(name==='filter_results'){
   if(!state.searchMeta)throw new Error('Najpierw wyszukaj rekordy.');
   state.results=state.results.filter(p=>matches(p,args)).map(p=>locate(p,args));
   if(args.audience!==undefined){state.searchMeta={...state.searchMeta};delete state.searchMeta.audienceFilterMapping;const mapping=audienceFilterMapping(args.audience);if(mapping)state.searchMeta.audienceFilterMapping=mapping;}
   return {...state.searchMeta,results:state.results,total:state.results.length};
 }
 if(name==='display_results'){
   if(!state.searchMeta)throw new Error('Najpierw wyszukaj rekordy.');
   const ids=[...new Set(args.ids)];let highlights=[...new Set(args.highlightIds)];
   if(ids.length!==args.ids.length||highlights.length!==args.highlightIds.length||highlights.some(id=>!ids.includes(id))||(ids.length&&highlights.length<1)||(!ids.length&&highlights.length))throw new Error('Wybierz 1–3 unikalne rekomendacje spośród wyników.');
   const byId=new Map(state.results.map(p=>[p.id,p]));
   if(ids.some(id=>!byId.has(id)))throw new Error('Najpierw wyszukaj wskazane rekordy.');
   const results=ids.map(id=>byId.get(id));
   highlights=touristHighlightIds(results,highlights);
   const action={type:'display_results',title:args.title,results,highlightIds:highlights,highlights:highlights.map(id=>byId.get(id)),dataMode:state.searchMeta?.dataMode||'official',complete:state.searchMeta?.complete??true,errors:state.searchMeta?.errors||[],...(state.searchMeta.audienceFilterMapping?{audienceFilterMapping:state.searchMeta.audienceFilterMapping}:{}),...(state.searchMeta.searches?{searches:state.searchMeta.searches}:{})};
   state.actions.push(action);
   return {displayed:results.length,highlightIds:highlights,action};
 }
 state.actions.push({type:'focus_map',...args});return{focused:true};
}
