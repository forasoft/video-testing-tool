const copyProperties = (src: object, dest: object, properties: string[]) => {
  properties.forEach((name) => {
    if (Object.prototype.hasOwnProperty.call(src, name)) {
      Object.defineProperty(dest, name, Object.getOwnPropertyDescriptor(src, name));
    }
  });
};

export default copyProperties;
