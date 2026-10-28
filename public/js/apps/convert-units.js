// Units for the Convert app. Each category has a base unit; `f` is how many base units one unit
// is. Units that aren't a simple multiple (temperature, fuel economy) give `to` (to base) and
// `from` (from base) instead. Values come from the exact definitions (the international yard
// and pound, US and imperial gallons, standard gravity and so on), so conversions are exact to
// the limits of floating point.

const IN = 0.0254, FT = 0.3048, YD = 0.9144, MI = 1609.344, NMI = 1852;
const LB = 0.45359237, OZ = LB / 16, GRAIN = 64.79891e-6;
const GAL = 3.785411784e-3, IGAL = 4.54609e-3;
const G0 = 9.80665, LBF = LB * G0;
const BTU = 1055.05585262, CAL = 4.1868;
const PI = Math.PI;

const u = (name, symbol, f, extra = {}) => ({ name, symbol, f, ...extra });

export const CATEGORIES = [
  { id: 'acceleration', name: 'Acceleration', base: 'm/s²', units: [
    u('meter/second²', 'm/s²', 1), u('centimeter/second² (gal)', 'Gal', 0.01), u('milligal', 'mGal', 1e-5), u('millimeter/second²', 'mm/s²', 1e-3),
    u('kilometer/hour/second', 'km/h/s', 1 / 3.6), u('kilometer/hour²', 'km/h²', 1000 / 3600 ** 2), u('foot/second²', 'ft/s²', FT), u('inch/second²', 'in/s²', IN),
    u('mile/hour/second', 'mph/s', MI / 3600), u('mile/hour²', 'mi/h²', MI / 3600 ** 2), u('knot/second', 'kn/s', NMI / 3600), u('standard gravity', 'g', G0),
  ] },
  { id: 'amount', name: 'Amount of Substance', base: 'mol', units: [
    u('mole', 'mol', 1), u('kilomole', 'kmol', 1e3), u('millimole', 'mmol', 1e-3), u('micromole', 'µmol', 1e-6), u('nanomole', 'nmol', 1e-9), u('picomole', 'pmol', 1e-12),
    u('pound-mole', 'lb-mol', LB * 1000), u('ounce-mole', 'oz-mol', OZ * 1000), u('particles (atoms, molecules)', 'N', 1 / 6.02214076e23),
  ] },
  { id: 'angle', name: 'Angle', base: 'rad', units: [
    u('degree', '°', PI / 180), u('radian', 'rad', 1), u('milliradian', 'mrad', 1e-3), u('grad (gon)', 'grad', PI / 200), u('minute of arc', '′', PI / 10800), u('second of arc', '″', PI / 648000),
    u('revolution (turn)', 'rev', 2 * PI), u('quadrant (right angle)', 'quad', PI / 2), u('sextant', 'sext', PI / 3), u('octant', 'oct', PI / 4),
    u('mil (NATO, 1/6400)', 'mil', 2 * PI / 6400), u('point (compass, 1/32)', 'pt', 2 * PI / 32), u('hour angle', 'h', 2 * PI / 24),
  ] },
  { id: 'area', name: 'Area', base: 'm²', units: [
    u('square millimeter', 'mm²', 1e-6), u('square centimeter', 'cm²', 1e-4), u('square decimeter', 'dm²', 1e-2), u('square meter', 'm²', 1), u('are', 'a', 100), u('hectare', 'ha', 1e4),
    u('square kilometer', 'km²', 1e6), u('square inch', 'in²', IN ** 2), u('square foot', 'ft²', FT ** 2), u('square yard', 'yd²', YD ** 2), u('square rod (perch)', 'rd²', (5.5 * YD) ** 2),
    u('rood', 'rood', 40 * (5.5 * YD) ** 2), u('acre', 'ac', 4840 * YD ** 2), u('square mile (section)', 'mi²', MI ** 2), u('township (36 mi²)', 'twp', 36 * MI ** 2),
    u('circular inch', 'circ in', PI / 4 * IN ** 2), u('circular mil', 'cmil', PI / 4 * (IN / 1000) ** 2), u('barn', 'b', 1e-28),
  ] },
  { id: 'computer', name: 'Computer', base: 'B', units: [
    u('bit', 'b', 1 / 8), u('nibble', 'nibble', 0.5), u('byte', 'B', 1),
    u('kilobit', 'kb', 125), u('kibibit', 'Kib', 128), u('kilobyte (1000 bytes)', 'kB', 1e3), u('kibibyte (1024 bytes)', 'KiB', 1024),
    u('megabit', 'Mb', 125e3), u('mebibit', 'Mib', 2 ** 17), u('megabyte (1000² bytes)', 'MB', 1e6), u('mebibyte (1024² bytes)', 'MiB', 2 ** 20),
    u('gigabit', 'Gb', 125e6), u('gibibit', 'Gib', 2 ** 27), u('gigabyte (1000³ bytes)', 'GB', 1e9), u('gibibyte (1024³ bytes)', 'GiB', 2 ** 30),
    u('terabit', 'Tb', 125e9), u('tebibit', 'Tib', 2 ** 37), u('terabyte (1000⁴ bytes)', 'TB', 1e12), u('tebibyte (1024⁴ bytes)', 'TiB', 2 ** 40),
    u('petabyte', 'PB', 1e15), u('pebibyte', 'PiB', 2 ** 50), u('exabyte', 'EB', 1e18), u('exbibyte', 'EiB', 2 ** 60),
    u('zettabyte', 'ZB', 1e21), u('zebibyte', 'ZiB', 2 ** 70), u('yottabyte', 'YB', 1e24), u('yobibyte', 'YiB', 2 ** 80),
    u('CD (74 minutes, 650 MiB)', 'CD', 650 * 2 ** 20), u('DVD (single layer, 4.7 GB)', 'DVD', 4.7e9), u('Blu-ray (single layer, 25 GB)', 'BD', 25e9),
  ] },
  { id: 'datarate', name: 'Computer (Data Rate)', base: 'B/s', units: [
    u('bit/second', 'bps', 1 / 8), u('byte/second', 'B/s', 1), u('kilobit/second', 'kbps', 125), u('kilobyte/second', 'kB/s', 1e3), u('kibibyte/second', 'KiB/s', 1024),
    u('megabit/second', 'Mbps', 125e3), u('megabyte/second', 'MB/s', 1e6), u('mebibyte/second', 'MiB/s', 2 ** 20), u('gigabit/second', 'Gbps', 125e6),
    u('gigabyte/second', 'GB/s', 1e9), u('gibibyte/second', 'GiB/s', 2 ** 30), u('terabit/second', 'Tbps', 125e9),
  ] },
  { id: 'molar', name: 'Concentration (Molar)', base: 'mol/m³', units: [
    u('mole/cubic meter', 'mol/m³', 1), u('mole/liter (molar)', 'M', 1e3), u('millimole/liter', 'mM', 1), u('micromole/liter', 'µM', 1e-3), u('nanomole/liter', 'nM', 1e-6),
    u('picomole/liter', 'pM', 1e-9), u('mole/cubic centimeter', 'mol/cm³', 1e6), u('kilomole/cubic meter', 'kmol/m³', 1e3), u('mole/cubic foot', 'mol/ft³', 1 / FT ** 3),
  ] },
  { id: 'massconc', name: 'Concentration (Mass)', base: 'kg/m³', units: [
    u('kilogram/cubic meter', 'kg/m³', 1), u('gram/liter', 'g/L', 1), u('milligram/liter', 'mg/L', 1e-3), u('microgram/liter', 'µg/L', 1e-6), u('nanogram/liter', 'ng/L', 1e-9),
    u('gram/milliliter', 'g/mL', 1e3), u('milligram/milliliter', 'mg/mL', 1), u('microgram/milliliter', 'µg/mL', 1e-3), u('gram/deciliter', 'g/dL', 10), u('milligram/deciliter', 'mg/dL', 1e-2),
    u('kilogram/liter', 'kg/L', 1e3), u('part per million (in water)', 'ppm', 1e-3), u('part per billion (in water)', 'ppb', 1e-6),
    u('grain/gallon (US)', 'gr/gal', GRAIN / GAL), u('pound/gallon (US)', 'lb/gal', LB / GAL), u('ounce/gallon (US)', 'oz/gal', OZ / GAL), u('pound/cubic foot', 'lb/ft³', LB / FT ** 3),
  ] },
  { id: 'density', name: 'Density', base: 'kg/m³', units: [
    u('kilogram/cubic meter', 'kg/m³', 1), u('gram/cubic centimeter', 'g/cm³', 1e3), u('gram/milliliter', 'g/mL', 1e3), u('gram/liter', 'g/L', 1), u('kilogram/liter', 'kg/L', 1e3),
    u('milligram/cubic centimeter', 'mg/cm³', 1), u('tonne/cubic meter', 't/m³', 1e3), u('pound/cubic inch', 'lb/in³', LB / IN ** 3), u('pound/cubic foot', 'lb/ft³', LB / FT ** 3),
    u('pound/cubic yard', 'lb/yd³', LB / YD ** 3), u('pound/gallon (US)', 'lb/gal', LB / GAL), u('pound/gallon (UK)', 'lb/gal UK', LB / IGAL), u('ounce/cubic inch', 'oz/in³', OZ / IN ** 3),
    u('ounce/cubic foot', 'oz/ft³', OZ / FT ** 3), u('ounce/gallon (US)', 'oz/gal', OZ / GAL), u('ounce/gallon (UK)', 'oz/gal UK', OZ / IGAL), u('slug/cubic foot', 'slug/ft³', (LBF / FT) / FT ** 3),
    u('short ton/cubic yard', 'ton/yd³', 2000 * LB / YD ** 3), u('long ton/cubic yard', 'LT/yd³', 2240 * LB / YD ** 3),
  ] },
  { id: 'distance', name: 'Distance', base: 'm', units: [
    u('angstrom', 'Å', 1e-10), u('nanometer', 'nm', 1e-9), u('micrometer (micron)', 'µm', 1e-6), u('millimeter', 'mm', 1e-3), u('centimeter', 'cm', 1e-2), u('decimeter', 'dm', 0.1),
    u('meter', 'm', 1), u('dekameter', 'dam', 10), u('hectometer', 'hm', 100), u('kilometer', 'km', 1e3), u('megameter', 'Mm', 1e6),
    u('mil (thou)', 'mil', IN / 1000), u('point (typography)', 'pt', IN / 72), u('pica', 'pica', IN / 6), u('line (1/12 inch)', 'line', IN / 12), u('inch', 'in', IN),
    u('hand', 'hand', 4 * IN), u('link', 'li', 0.66 * FT), u('span', 'span', 9 * IN), u('foot', 'ft', FT), u('foot (US survey)', 'ft US', 1200 / 3937), u('cubit', 'cubit', 18 * IN),
    u('yard', 'yd', YD), u('fathom', 'ftm', 6 * FT), u('rod (pole, perch)', 'rd', 5.5 * YD), u('chain', 'ch', 22 * YD), u('furlong', 'fur', 220 * YD), u('cable (international)', 'cable', NMI / 10),
    u('mile', 'mi', MI), u('mile (US survey)', 'mi US', 5280 * 1200 / 3937), u('nautical mile', 'NM', NMI), u('league (3 miles)', 'lea', 3 * MI),
    u('earth radius (mean)', 'R⊕', 6371e3), u('light second', 'ls', 299792458), u('astronomical unit', 'au', 149597870700), u('light year', 'ly', 9460730472580800), u('parsec', 'pc', 648000 / PI * 149597870700),
  ] },
  { id: 'energy', name: 'Energy', base: 'J', units: [
    u('joule', 'J', 1), u('millijoule', 'mJ', 1e-3), u('kilojoule', 'kJ', 1e3), u('megajoule', 'MJ', 1e6), u('gigajoule', 'GJ', 1e9),
    u('calorie (international)', 'cal', CAL), u('calorie (thermochemical)', 'cal th', 4.184), u('kilocalorie (international)', 'kcal', CAL * 1000), u('Calorie (food, kcal)', 'Cal', 4184),
    u('watt-hour', 'Wh', 3600), u('kilowatt-hour', 'kWh', 3.6e6), u('megawatt-hour', 'MWh', 3.6e9), u('electronvolt', 'eV', 1.602176634e-19), u('kiloelectronvolt', 'keV', 1.602176634e-16),
    u('megaelectronvolt', 'MeV', 1.602176634e-13), u('erg', 'erg', 1e-7), u('foot-pound force', 'ft·lbf', LBF * FT), u('inch-pound force', 'in·lbf', LBF * IN), u('foot-poundal', 'ft·pdl', LB * FT * FT),
    u('British thermal unit (IT)', 'BTU', BTU), u('therm (US)', 'thm', 105480400), u('therm (EC)', 'thm EC', 105506000), u('quad', 'quad', BTU * 1e15),
    u('horsepower-hour', 'hp·h', 550 * LBF * FT * 3600), u('kilogram-force meter', 'kgf·m', G0), u('ton of TNT', 'tTNT', 4.184e9), u('barrel of oil equivalent', 'BOE', 6.1178632e9), u('hartree', 'Eh', 4.3597447222071e-18),
  ] },
  { id: 'flow', name: 'Flow', base: 'm³/s', units: [
    u('cubic meter/second', 'm³/s', 1), u('cubic meter/minute', 'm³/min', 1 / 60), u('cubic meter/hour', 'm³/h', 1 / 3600), u('cubic meter/day', 'm³/d', 1 / 86400),
    u('liter/second', 'L/s', 1e-3), u('liter/minute', 'L/min', 1e-3 / 60), u('liter/hour', 'L/h', 1e-3 / 3600), u('milliliter/second', 'mL/s', 1e-6), u('milliliter/minute', 'mL/min', 1e-6 / 60),
    u('cubic foot/second', 'cfs', FT ** 3), u('cubic foot/minute', 'cfm', FT ** 3 / 60), u('cubic foot/hour', 'ft³/h', FT ** 3 / 3600), u('cubic inch/second', 'in³/s', IN ** 3), u('cubic inch/minute', 'in³/min', IN ** 3 / 60),
    u('gallon (US)/second', 'gal/s', GAL), u('gallon (US)/minute', 'gpm', GAL / 60), u('gallon (US)/hour', 'gph', GAL / 3600), u('gallon (US)/day', 'gpd', GAL / 86400),
    u('gallon (UK)/second', 'gal UK/s', IGAL), u('gallon (UK)/minute', 'gal UK/min', IGAL / 60), u('gallon (UK)/hour', 'gal UK/h', IGAL / 3600),
    u('barrel (oil)/day', 'bbl/d', 42 * GAL / 86400), u('barrel (oil)/hour', 'bbl/h', 42 * GAL / 3600), u('acre-foot/day', 'ac·ft/d', 4840 * YD ** 2 * FT / 86400), u('acre-foot/year', 'ac·ft/yr', 4840 * YD ** 2 * FT / 31557600),
  ] },
  { id: 'force', name: 'Force', base: 'N', units: [
    u('newton', 'N', 1), u('millinewton', 'mN', 1e-3), u('kilonewton', 'kN', 1e3), u('meganewton', 'MN', 1e6), u('dyne', 'dyn', 1e-5), u('gram-force', 'gf', G0 / 1000),
    u('kilogram-force (kilopond)', 'kgf', G0), u('tonne-force', 'tf', G0 * 1000), u('pound-force', 'lbf', LBF), u('ounce-force', 'ozf', LBF / 16), u('poundal', 'pdl', LB * FT),
    u('kip (kilopound-force)', 'kip', LBF * 1000), u('short ton-force', 'tonf US', LBF * 2000), u('long ton-force', 'tonf UK', LBF * 2240), u('sthène', 'sn', 1e3),
  ] },
  { id: 'frequency', name: 'Frequency', base: 'Hz', units: [
    u('hertz', 'Hz', 1), u('millihertz', 'mHz', 1e-3), u('kilohertz', 'kHz', 1e3), u('megahertz', 'MHz', 1e6), u('gigahertz', 'GHz', 1e9), u('terahertz', 'THz', 1e12),
    u('cycle/minute', 'cpm', 1 / 60), u('revolution/minute', 'rpm', 1 / 60), u('revolution/second', 'rps', 1), u('radian/second', 'rad/s', 1 / (2 * PI)), u('degree/second', '°/s', 1 / 360), u('beats per minute', 'bpm', 1 / 60),
  ] },
  { id: 'fuel', name: 'Fuel Economy', base: 'km/L', units: [
    u('kilometer/liter', 'km/L', 1), u('liter/100 kilometers', 'L/100 km', null, { to: (v) => 100 / v, from: (v) => 100 / v }),
    u('mile/gallon (US)', 'mpg', MI / 1000 / GAL / 1000), u('mile/gallon (UK)', 'mpg UK', MI / 1000 / IGAL / 1000), u('mile/liter', 'mi/L', MI / 1000),
    u('gallon (US)/100 miles', 'gal/100 mi', null, { to: (v) => (100 * MI / 1000) / (v * GAL * 1000), from: (v) => (100 * MI / 1000) / (v * GAL * 1000) }),
    u('gallon (UK)/100 miles', 'gal UK/100 mi', null, { to: (v) => (100 * MI / 1000) / (v * IGAL * 1000), from: (v) => (100 * MI / 1000) / (v * IGAL * 1000) }),
    u('kilometer/gallon (US)', 'km/gal', 1 / (GAL * 1000)), u('meter/liter', 'm/L', 1e-3),
  ] },
  { id: 'light', name: 'Light (Illuminance)', base: 'lx', units: [
    u('lux (lumen/square meter)', 'lx', 1), u('kilolux', 'klx', 1e3), u('millilux', 'mlx', 1e-3), u('nox', 'nx', 1e-3), u('phot (lumen/square centimeter)', 'ph', 1e4),
    u('footcandle (lumen/square foot)', 'fc', 1 / FT ** 2), u('lumen/square inch', 'lm/in²', 1 / IN ** 2), u('watt/square centimeter (at 555 nm)', 'W/cm²', 683e4),
  ] },
  { id: 'luminance', name: 'Light (Luminance)', base: 'cd/m²', units: [
    u('candela/square meter (nit)', 'cd/m²', 1), u('kilocandela/square meter', 'kcd/m²', 1e3), u('candela/square centimeter', 'cd/cm²', 1e4), u('stilb', 'sb', 1e4),
    u('candela/square foot', 'cd/ft²', 1 / FT ** 2), u('candela/square inch', 'cd/in²', 1 / IN ** 2), u('footlambert', 'fL', 1 / PI / FT ** 2), u('lambert', 'L', 1e4 / PI),
    u('millilambert', 'mL', 10 / PI), u('apostilb (blondel)', 'asb', 1 / PI), u('skot', 'sk', 1e-3 / PI),
  ] },
  { id: 'mass', name: 'Mass', base: 'kg', units: [
    u('microgram', 'µg', 1e-9), u('milligram', 'mg', 1e-6), u('centigram', 'cg', 1e-5), u('decigram', 'dg', 1e-4), u('gram', 'g', 1e-3), u('dekagram', 'dag', 1e-2), u('hectogram', 'hg', 0.1),
    u('kilogram', 'kg', 1), u('quintal', 'q', 100), u('tonne (metric ton)', 't', 1e3), u('carat', 'ct', 2e-4), u('grain', 'gr', GRAIN), u('dram (avoirdupois)', 'dr', OZ / 16),
    u('ounce', 'oz', OZ), u('pound', 'lb', LB), u('stone', 'st', 14 * LB), u('quarter (UK)', 'qr', 28 * LB), u('hundredweight (US, short)', 'cwt US', 100 * LB), u('hundredweight (UK, long)', 'cwt UK', 112 * LB),
    u('ton (US, short)', 'ton', 2000 * LB), u('ton (UK, long)', 'LT', 2240 * LB), u('pennyweight', 'dwt', 24 * GRAIN), u('ounce (troy)', 'oz t', 480 * GRAIN), u('pound (troy)', 'lb t', 5760 * GRAIN),
    u('scruple (apothecary)', '℈', 20 * GRAIN), u('dram (apothecary)', 'ʒ', 60 * GRAIN), u('slug', 'slug', LBF / FT), u('atomic mass unit (dalton)', 'u', 1.66053906660e-27), u('electron mass', 'mₑ', 9.1093837015e-31),
  ] },
  { id: 'power', name: 'Power', base: 'W', units: [
    u('watt', 'W', 1), u('milliwatt', 'mW', 1e-3), u('kilowatt', 'kW', 1e3), u('megawatt', 'MW', 1e6), u('gigawatt', 'GW', 1e9), u('terawatt', 'TW', 1e12),
    u('horsepower (mechanical)', 'hp', 550 * LBF * FT), u('horsepower (metric)', 'PS', 75 * G0), u('horsepower (electric)', 'hp(E)', 746), u('horsepower (boiler)', 'hp(S)', 9809.5),
    u('BTU/hour', 'BTU/h', BTU / 3600), u('BTU/minute', 'BTU/min', BTU / 60), u('BTU/second', 'BTU/s', BTU), u('ton of refrigeration', 'TR', 12000 * BTU / 3600),
    u('foot-pound force/second', 'ft·lbf/s', LBF * FT), u('foot-pound force/minute', 'ft·lbf/min', LBF * FT / 60), u('calorie/second', 'cal/s', CAL), u('kilocalorie/hour', 'kcal/h', CAL * 1000 / 3600),
    u('joule/second', 'J/s', 1), u('erg/second', 'erg/s', 1e-7), u('kilogram-force meter/second', 'kgf·m/s', G0), u('volt-ampere', 'VA', 1),
  ] },
  { id: 'pressure', name: 'Pressure', base: 'Pa', units: [
    u('pascal', 'Pa', 1), u('hectopascal', 'hPa', 100), u('kilopascal', 'kPa', 1e3), u('megapascal', 'MPa', 1e6), u('gigapascal', 'GPa', 1e9), u('bar', 'bar', 1e5), u('millibar', 'mbar', 100),
    u('atmosphere (standard)', 'atm', 101325), u('atmosphere (technical, kgf/cm²)', 'at', G0 * 1e4), u('torr', 'Torr', 101325 / 760), u('millimeter of mercury', 'mmHg', 133.322387415),
    u('inch of mercury (32 °F)', 'inHg', 3386.389), u('pound/square inch', 'psi', LBF / IN ** 2), u('kilopound/square inch', 'ksi', 1000 * LBF / IN ** 2), u('pound/square foot', 'psf', LBF / FT ** 2),
    u('inch of water (4 °C)', 'inH₂O', 249.08891), u('foot of water (4 °C)', 'ftH₂O', 2989.06692), u('millimeter of water', 'mmH₂O', G0), u('centimeter of water', 'cmH₂O', G0 * 10), u('meter of water', 'mH₂O', G0 * 1000),
    u('dyne/square centimeter (barye)', 'Ba', 0.1), u('kilogram-force/square meter', 'kgf/m²', G0), u('newton/square millimeter', 'N/mm²', 1e6), u('short ton/square foot', 'tsf', 2000 * LBF / FT ** 2),
  ] },
  { id: 'speed', name: 'Speed', base: 'm/s', units: [
    u('meter/second', 'm/s', 1), u('meter/minute', 'm/min', 1 / 60), u('meter/hour', 'm/h', 1 / 3600), u('kilometer/hour', 'km/h', 1 / 3.6), u('kilometer/second', 'km/s', 1e3),
    u('centimeter/second', 'cm/s', 0.01), u('millimeter/second', 'mm/s', 1e-3), u('mile/hour', 'mph', MI / 3600), u('mile/minute', 'mi/min', MI / 60), u('mile/second', 'mi/s', MI),
    u('foot/second', 'ft/s', FT), u('foot/minute', 'ft/min', FT / 60), u('foot/hour', 'ft/h', FT / 3600), u('inch/second', 'in/s', IN), u('yard/second', 'yd/s', YD),
    u('knot', 'kn', NMI / 3600), u('Mach (sea level, 15 °C)', 'Ma', 340.294), u('speed of sound (dry air, 20 °C)', 'c air', 343.2), u('speed of light (vacuum)', 'c', 299792458),
    u('furlong/fortnight', 'fur/ftn', 220 * YD / 1209600),
  ] },
  { id: 'temperature', name: 'Temperature', base: 'K', units: [
    u('Celsius', '°C', null, { to: (v) => v + 273.15, from: (k) => k - 273.15 }),
    u('Fahrenheit', '°F', null, { to: (v) => (v + 459.67) * 5 / 9, from: (k) => k * 9 / 5 - 459.67 }),
    u('Kelvin', 'K', 1),
    u('Rankine', '°R', 5 / 9),
    u('Réaumur', '°Ré', null, { to: (v) => v * 1.25 + 273.15, from: (k) => (k - 273.15) * 0.8 }),
    u('Rømer', '°Rø', null, { to: (v) => (v - 7.5) * 40 / 21 + 273.15, from: (k) => (k - 273.15) * 21 / 40 + 7.5 }),
    u('Newton', '°N', null, { to: (v) => v * 100 / 33 + 273.15, from: (k) => (k - 273.15) * 33 / 100 }),
    u('Delisle', '°De', null, { to: (v) => 373.15 - v * 2 / 3, from: (k) => (373.15 - k) * 1.5 }),
  ] },
  { id: 'time', name: 'Time', base: 's', units: [
    u('nanosecond', 'ns', 1e-9), u('microsecond', 'µs', 1e-6), u('millisecond', 'ms', 1e-3), u('second', 's', 1), u('minute', 'min', 60), u('hour', 'h', 3600), u('day', 'd', 86400),
    u('week', 'wk', 604800), u('fortnight', 'ftn', 1209600), u('month (average, 1/12 year)', 'mo', 2629746), u('year (365 days)', 'yr', 31536000), u('year (Julian, 365.25 days)', 'a', 31557600),
    u('year (Gregorian, 365.2425 days)', 'yr G', 31556952), u('year (tropical)', 'yr t', 31556925.216), u('decade', 'dec', 315569520), u('century', 'c', 3155695200), u('millennium', 'ka', 31556952000),
    u('shake', 'shake', 1e-8), u('sidereal day', 'd sid', 86164.0905),
  ] },
  { id: 'torque', name: 'Torque', base: 'N·m', units: [
    u('newton meter', 'N·m', 1), u('kilonewton meter', 'kN·m', 1e3), u('newton centimeter', 'N·cm', 1e-2), u('newton millimeter', 'N·mm', 1e-3), u('dyne centimeter', 'dyn·cm', 1e-7),
    u('kilogram-force meter', 'kgf·m', G0), u('kilogram-force centimeter', 'kgf·cm', G0 / 100), u('gram-force centimeter', 'gf·cm', G0 / 1e5),
    u('pound-force foot', 'lbf·ft', LBF * FT), u('pound-force inch', 'lbf·in', LBF * IN), u('ounce-force inch', 'ozf·in', LBF / 16 * IN), u('ounce-force foot', 'ozf·ft', LBF / 16 * FT), u('poundal foot', 'pdl·ft', LB * FT * FT),
  ] },
  { id: 'volume', name: 'Volume', base: 'm³', units: [
    u('cubic millimeter', 'mm³', 1e-9), u('cubic centimeter', 'cm³', 1e-6), u('milliliter', 'mL', 1e-6), u('centiliter', 'cL', 1e-5), u('deciliter', 'dL', 1e-4), u('liter', 'L', 1e-3),
    u('hectoliter', 'hL', 0.1), u('cubic meter', 'm³', 1), u('cubic kilometer', 'km³', 1e9), u('cubic inch', 'in³', IN ** 3), u('cubic foot', 'ft³', FT ** 3), u('cubic yard', 'yd³', YD ** 3), u('cubic mile', 'mi³', MI ** 3),
    u('acre-foot', 'ac·ft', 4840 * YD ** 2 * FT), u('board foot', 'FBM', FT ** 2 * IN), u('cord (firewood)', 'cd', 128 * FT ** 3),
    u('teaspoon (US)', 'tsp', GAL / 768), u('tablespoon (US)', 'tbsp', GAL / 256), u('fluid ounce (US)', 'fl oz', GAL / 128), u('gill (US)', 'gi', GAL / 32), u('cup (US)', 'cup', GAL / 16),
    u('pint (US liquid)', 'pt', GAL / 8), u('quart (US liquid)', 'qt', GAL / 4), u('gallon (US liquid)', 'gal', GAL), u('barrel (US liquid, 31.5 gal)', 'bbl', 31.5 * GAL), u('barrel (oil, 42 gal)', 'bbl oil', 42 * GAL),
    u('hogshead (US, 63 gal)', 'hhd', 63 * GAL), u('minim (US)', 'min', GAL / 61440), u('fluid dram (US)', 'fl dr', GAL / 1024),
    u('teaspoon (UK)', 'tsp UK', IGAL / 160 * 5 / 24), u('tablespoon (UK)', 'tbsp UK', IGAL / 160 * 5 / 8), u('fluid ounce (UK)', 'fl oz UK', IGAL / 160), u('gill (UK)', 'gi UK', IGAL / 32), u('cup (UK)', 'cup UK', IGAL / 16),
    u('pint (UK)', 'pt UK', IGAL / 8), u('quart (UK)', 'qt UK', IGAL / 4), u('gallon (UK)', 'gal UK', IGAL), u('barrel (UK, 36 gal)', 'bbl UK', 36 * IGAL),
    u('teaspoon (metric)', 'tsp m', 5e-6), u('tablespoon (metric)', 'tbsp m', 15e-6), u('cup (metric)', 'cup m', 250e-6),
  ] },
  { id: 'volumedry', name: 'Volume (Dry)', base: 'm³', units: [
    u('liter', 'L', 1e-3), u('cubic decimeter', 'dm³', 1e-3), u('cubic meter', 'm³', 1), u('cubic inch', 'in³', IN ** 3), u('cubic foot', 'ft³', FT ** 3),
    u('pint (US dry)', 'pt dry', 33.6003125 * IN ** 3), u('quart (US dry)', 'qt dry', 67.200625 * IN ** 3), u('gallon (US dry)', 'gal dry', 268.8025 * IN ** 3), u('peck (US)', 'pk', 537.605 * IN ** 3),
    u('bushel (US)', 'bu', 2150.42 * IN ** 3), u('barrel (US dry)', 'bbl dry', 7056 * IN ** 3), u('peck (UK)', 'pk UK', 2 * IGAL), u('bushel (UK)', 'bu UK', 8 * IGAL), u('quarter (UK, 8 bushels)', 'qr UK', 64 * IGAL),
  ] },
];

export const toBase = (unit, v) => (unit.to ? unit.to(v) : v * unit.f);
export const fromBase = (unit, v) => (unit.from ? unit.from(v) : v / unit.f);
export const convert = (v, from, to) => fromBase(to, toBase(from, v));
