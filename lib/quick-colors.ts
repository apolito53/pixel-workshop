/**
 * Familiar, fixed drawing-program swatches. Unlike generated color harmonies,
 * these never depend on a canvas and never enter a project's saved palette
 * until the artist explicitly chooses "Save current color".
 */
export type QuickColor={name:string;hex:string};
export type QuickColorGroup={id:'neutral'|'spectrum'|'earth';label:string;colors:readonly QuickColor[]};
export const QUICK_COLOR_GROUPS:readonly QuickColorGroup[]=[
 {id:'neutral',label:'Neutrals',colors:[
  {name:'Black',hex:'#000000'},
  {name:'Charcoal',hex:'#333333'},
  {name:'Gray',hex:'#808080'},
  {name:'Silver',hex:'#bfbfbf'},
  {name:'Off-white',hex:'#f5f5f5'},
  {name:'White',hex:'#ffffff'},
 ]},
 {id:'spectrum',label:'Basic colors',colors:[
  {name:'Red',hex:'#ff0000'},
  {name:'Orange',hex:'#ff8000'},
  {name:'Yellow',hex:'#ffff00'},
  {name:'Lime',hex:'#80ff00'},
  {name:'Green',hex:'#00ff00'},
  {name:'Teal',hex:'#008080'},
  {name:'Cyan',hex:'#00ffff'},
  {name:'Blue',hex:'#0000ff'},
  {name:'Indigo',hex:'#4b0082'},
  {name:'Violet',hex:'#8000ff'},
  {name:'Magenta',hex:'#ff00ff'},
  {name:'Pink',hex:'#ff80bf'},
 ]},
 {id:'earth',label:'Earth & accents',colors:[
  {name:'Maroon',hex:'#800000'},
  {name:'Navy',hex:'#000080'},
  {name:'Olive',hex:'#808000'},
  {name:'Brown',hex:'#8b4513'},
  {name:'Tan',hex:'#cba06d'},
  {name:'Peach',hex:'#f4c7a1'},
 ]},
];
export const QUICK_COLORS=QUICK_COLOR_GROUPS.flatMap(group=>group.colors);
