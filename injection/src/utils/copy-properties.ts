// Copies the own properties `properties` of `src` to `dest` with their descriptors (getters and flags included).
const copyProperties = (src: object, dest: object, properties: string[]) => {
  properties.forEach((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(src, name);
    if (descriptor) {
      Object.defineProperty(dest, name, descriptor);
    }
  });
};

export default copyProperties;
