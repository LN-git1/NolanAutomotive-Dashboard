/**
 * Vehicle makes and their models, for the Job form dropdowns.
 *
 * Scope is the Irish market: the makes and models actually seen in a Kildare
 * workshop, including the vans a garage services as often as cars. It is not
 * meant to be a global vehicle database — it is meant to cover the realistic
 * 99% so the owner taps twice instead of typing on a phone.
 *
 * The remaining 1% is why every make and model field also offers "Other…",
 * which swaps in a free-text box. A dropdown-only field would block a job
 * outright the first time an unusual vehicle came through the door, so the
 * escape hatch is a requirement, not a nicety.
 *
 * Models are listed alphabetically; the picker sorts makes alphabetically too.
 */

export const OTHER_OPTION = '__other__';

export const VEHICLE_MAKES: Record<string, string[]> = {
  'Alfa Romeo': ['147', '156', '159', 'Giulia', 'Giulietta', 'MiTo', 'Stelvio', 'Tonale'],
  Audi: [
    'A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'e-tron', 'Q2', 'Q3', 'Q4 e-tron', 'Q5', 'Q7', 'Q8',
    'TT',
  ],
  BMW: [
    '1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series', '8 Series',
    'i3', 'i4', 'iX', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4',
  ],
  BYD: ['Atto 3', 'Dolphin', 'Seal', 'Sealion 7'],
  Chevrolet: ['Aveo', 'Captiva', 'Cruze', 'Spark'],
  Chrysler: ['300C', 'Grand Voyager', 'Voyager'],
  Citroën: [
    'Berlingo', 'C1', 'C3', 'C3 Aircross', 'C4', 'C4 Cactus', 'C5', 'C5 Aircross', 'Dispatch',
    'Grand C4 Picasso', 'Jumper', 'Nemo', 'Relay',
  ],
  Cupra: ['Ateca', 'Born', 'Formentor', 'Leon', 'Tavascan'],
  Dacia: ['Duster', 'Jogger', 'Logan', 'Sandero', 'Spring'],
  DS: ['DS 3', 'DS 4', 'DS 7'],
  Fiat: ['500', '500L', '500X', 'Doblo', 'Ducato', 'Panda', 'Punto', 'Scudo', 'Tipo'],
  Ford: [
    'B-Max', 'C-Max', 'Connect', 'Custom', 'EcoSport', 'Edge', 'Escort', 'Explorer', 'Fiesta',
    'Focus', 'Fusion', 'Galaxy', 'Ka', 'Kuga', 'Mondeo', 'Mustang', 'Mustang Mach-E', 'Puma',
    'Ranger', 'S-Max', 'Tourneo', 'Transit', 'Transit Connect', 'Transit Courier',
    'Transit Custom',
  ],
  Honda: ['Accord', 'Civic', 'CR-V', 'HR-V', 'Insight', 'Jazz', 'ZR-V'],
  Hyundai: [
    'i10', 'i20', 'i30', 'i40', 'Bayon', 'Ioniq', 'Ioniq 5', 'Ioniq 6', 'iX20', 'iX35', 'Kona',
    'Santa Fe', 'Tucson',
  ],
  Isuzu: ['D-Max'],
  Iveco: ['Daily'],
  Jaguar: ['E-Pace', 'F-Pace', 'I-Pace', 'XE', 'XF', 'XJ'],
  Jeep: ['Avenger', 'Cherokee', 'Compass', 'Grand Cherokee', 'Renegade', 'Wrangler'],
  Kia: [
    'Ceed', 'EV6', 'EV3', 'Niro', 'Optima', 'Picanto', 'ProCeed', 'Rio', 'Sorento', 'Soul',
    'Sportage', 'Stonic', 'Venga', 'XCeed',
  ],
  'Land Rover': [
    'Defender', 'Discovery', 'Discovery Sport', 'Freelander', 'Range Rover', 'Range Rover Evoque',
    'Range Rover Sport', 'Range Rover Velar',
  ],
  Lexus: ['CT', 'ES', 'IS', 'NX', 'RX', 'UX'],
  Mazda: ['2', '3', '6', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'MX-5'],
  'Mercedes-Benz': [
    'A-Class', 'B-Class', 'C-Class', 'Citan', 'CLA', 'E-Class', 'EQA', 'EQB', 'EQC', 'GLA', 'GLB',
    'GLC', 'GLE', 'S-Class', 'Sprinter', 'V-Class', 'Vito',
  ],
  MG: ['HS', 'MG3', 'MG4', 'MG5', 'ZS'],
  MINI: ['Clubman', 'Countryman', 'Hatch', 'Convertible'],
  Mitsubishi: ['ASX', 'L200', 'Outlander', 'Pajero', 'Space Star'],
  Nissan: [
    'Ariya', 'Juke', 'Leaf', 'Micra', 'Navara', 'Note', 'NV200', 'NV300', 'Pulsar', 'Qashqai',
    'X-Trail',
  ],
  Opel: [
    'Adam', 'Astra', 'Combo', 'Corsa', 'Crossland', 'Grandland', 'Insignia', 'Meriva', 'Mokka',
    'Movano', 'Vivaro', 'Zafira',
  ],
  Peugeot: [
    '108', '2008', '206', '207', '208', '3008', '308', '407', '5008', '508', 'Boxer', 'Expert',
    'Partner', 'Rifter', 'Traveller',
  ],
  Polestar: ['Polestar 2', 'Polestar 3', 'Polestar 4'],
  Porsche: ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'],
  Renault: [
    'Arkana', 'Captur', 'Clio', 'Fluence', 'Grand Scenic', 'Kadjar', 'Kangoo', 'Koleos', 'Master',
    'Megane', 'Scenic', 'Trafic', 'Twingo', 'Zoe',
  ],
  Saab: ['9-3', '9-5'],
  SEAT: ['Alhambra', 'Arona', 'Ateca', 'Ibiza', 'Leon', 'Mii', 'Tarraco', 'Toledo'],
  Skoda: [
    'Citigo', 'Enyaq', 'Fabia', 'Kamiq', 'Karoq', 'Kodiaq', 'Octavia', 'Rapid', 'Roomster',
    'Scala', 'Superb', 'Yeti',
  ],
  Ssangyong: ['Korando', 'Musso', 'Rexton', 'Tivoli'],
  Subaru: ['Forester', 'Impreza', 'Outback', 'XV'],
  Suzuki: ['Alto', 'Baleno', 'Celerio', 'Ignis', 'Jimny', 'S-Cross', 'Swift', 'Vitara'],
  Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y'],
  Toyota: [
    'Auris', 'Avensis', 'Aygo', 'C-HR', 'Camry', 'Corolla', 'Hiace', 'Highlander', 'Hilux',
    'Land Cruiser', 'Prius', 'Proace', 'RAV4', 'Verso', 'Yaris', 'Yaris Cross',
  ],
  Volkswagen: [
    'Amarok', 'Arteon', 'Beetle', 'Caddy', 'California', 'Caravelle', 'Crafter', 'Golf',
    'Golf Plus', 'ID.3', 'ID.4', 'ID.5', 'ID. Buzz', 'Jetta', 'Passat', 'Polo', 'Scirocco',
    'Sharan', 'T-Cross', 'T-Roc', 'Tiguan', 'Touareg', 'Touran', 'Transporter', 'Up',
  ],
  Volvo: ['C40', 'S60', 'S90', 'V40', 'V60', 'V90', 'XC40', 'XC60', 'XC90'],
};

/** Makes, alphabetical. `localeCompare` so accented names sort sensibly. */
export const MAKE_NAMES = Object.keys(VEHICLE_MAKES).sort((a, b) => a.localeCompare(b, 'en'));

export function modelsForMake(make: string | null | undefined): string[] {
  if (!make) return [];
  return VEHICLE_MAKES[make] ?? [];
}

export function isKnownMake(make: string | null | undefined): boolean {
  return Boolean(make && make in VEHICLE_MAKES);
}

export function isKnownModel(make: string | null | undefined, model: string | null | undefined): boolean {
  if (!make || !model) return false;
  return modelsForMake(make).includes(model);
}

/**
 * Years offered, newest first. The upper bound is next year because dealers
 * register plates ahead of the calendar; the lower bound covers anything old
 * enough to still be arriving on a tow truck.
 */
export function vehicleYears(now: Date = new Date()): number[] {
  const newest = now.getFullYear() + 1;
  const oldest = 1980;
  const years: number[] = [];
  for (let year = newest; year >= oldest; year -= 1) years.push(year);
  return years;
}
