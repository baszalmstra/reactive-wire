import { shallowRef } from "@vue/reactivity";

/** A readable reactive value. */
export type Getter<T> = () => T;

/** A writable reactive cell. */
export interface Cell<T> {
  get: Getter<T>;
  set: (value: T) => void;
}

export function cell<T>(initial: T): Cell<T> {
  const ref = shallowRef(initial);
  return {
    get: () => ref.value,
    set: (value: T) => {
      ref.value = value;
    },
  };
}
