'use strict';

importScripts('vendor/libheif-bundle.js');

self.onmessage = async ({data:bytes}) => {
  try {
    const library = await libheif();
    const decoder = new library.HeifDecoder();
    const images = decoder.decode(new Uint8Array(bytes));
    const image = images.find(entry=>entry.is_primary()) || images[0];
    if (!image) throw new Error('No image');
    const width = image.get_width(), height = image.get_height();
    const data = new Uint8ClampedArray(width*height*4);
    const pixels = await new Promise((resolve,reject)=>{
      image.display({width,height,data},result=>result ? resolve(result.data) : reject(new Error('HEIC decode failed')));
    });
    self.postMessage({width,height,pixels},[pixels.buffer]);
  } catch {
    self.postMessage({error:true});
  }
};
