// Verified against the city's published *_pw.json examples and live responses, 2026-10-17.
export const SOURCES = {
 event: { title: 'Kalendarz wydarzeń', id: 'ba202e4b-dfa9-440c-83c0-0b3517520cb8', action: 'get_bmm_kalendarz_wydarzen', spec: 'bmm_kalendarz_wydarzen' },
 sports: { title: 'Zajęcia sportowe', id: '911aa2e8-d021-4dab-b5ff-751079cf902c', action: 'get_bmm_zajecia_sportowe', spec: 'bmm_zajecia_sportowe' },
 weather: { title: 'Pogoda', id: 'db8077a8-d0e0-480a-af5d-040fb0ea176f', action: 'get_zom_pogoda', spec: 'zom_pogoda' },
 pitch: { title: 'Otwarte boiska', id: '32a0ad2d-06d7-4e9c-acef-17a35c083d8c', action: 'get_be_otwarte_boiska', spec: 'be_otwarte_boiska' },
 route: { title: 'Trasy turystyczne', id: '00394370-1299-4d98-9910-0983fa7e7612', action: 'get_sbt_trasy_turystyczne', spec: 'sbt_trasy_turystyczne' },
 air_quality: { title: 'Monitoring jakości powietrza', id: '6a7e64d6-b451-4aa5-99d1-2dacece4323b', action: 'get_bopipk_monitoring_jakosci_powietrza', spec: 'bopipk_monitoring_jakosci_powietrza' },
};
// Weather/air are supplied automatically by the server's environment context.
export const SEARCH_CATEGORIES = ['event', 'sports', 'pitch', 'route'];
