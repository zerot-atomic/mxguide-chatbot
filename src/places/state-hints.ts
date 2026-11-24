import { normalize } from './state-resolver';

/**
 * Pista léxica (sin red) de que el mensaje podría nombrar un estado. Solo decide si vale la pena
 * consultar /states; la resolución real sigue usando los nombres e IDs del catálogo.
 */
export const STATE_HINTS = [
  'aguascalientes', 'baja california', 'campeche', 'chiapas', 'chihuahua', 'ciudad de mexico', 'cdmx', 'coahuila', 'colima',
  'durango', 'estado de mexico', 'edomex', 'guanajuato', 'guerrero', 'hidalgo', 'jalisco', 'michoacan', 'morelos', 'nayarit',
  'nuevo leon', 'oaxaca', 'puebla', 'queretaro', 'quintana roo', 'san luis potosi', 'sinaloa', 'sonora', 'tabasco',
  'tamaulipas', 'tlaxcala', 'veracruz', 'yucatan', 'zacatecas', 'mexico',
];

export function mentionsKnownState(message: string): boolean {
  const text = ` ${normalize(message)} `;
  return STATE_HINTS.some(name => text.includes(` ${name} `));
}

/**
 * Continuación corta que pide más de la misma búsqueda («¿y cuáles más?», «¿qué otros hay ahí?»).
 * Un «¿y…?» con otro tema («¿y qué ropa llevo?», «¿y tú quién eres?») no hereda el estado.
 */
export function isShortContinuation(message: string): boolean {
  const text = normalize(message).replace(/^y /, '');
  if (text.split(' ').length > 7) return false;
  return /^(cuales|que otros|que otras|que mas|algo mas|mas|otros|otras|alguno mas|alguna mas)( (mas|hay|tienes|me recomiendas|recomiendas|opciones|lugares|sitios|alli|ahi|por alli|por ahi|en ese estado|en el mismo estado))*$/.test(text);
}
