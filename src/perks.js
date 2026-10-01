// The four perks of the first build. All are one-time items.

export const PERKS = {
  wall:   { id: 'wall',   name: 'Wall',    phase: 'before', target: 'gap',
            desc: 'Place a short wall between two adjacent pegs. Lasts the round.' },
  block:  { id: 'block',  name: 'Block',   phase: 'before', target: 'slot',
            desc: 'Cap one slot for the round. Balls roll off into a neighbor.' },
  double: { id: 'double', name: 'Double',  phase: 'before', target: 'slot',
            desc: "Double one slot's value for the round." },
  redrop: { id: 'redrop', name: 'Re-drop', phase: 'after',  target: 'ball',
            desc: 'Drop one landed ball again. The new result replaces the old one.' },
};

export const PERK_IDS = ['wall', 'block', 'double', 'redrop'];
