// Resources outside ASAR are usable both from the main service and oneshot script.
export function resolveUnpackedRoot(root) {
  return root.replace(/(^|[/\\])app\.asar(?=$|[/\\])/,'$1app.asar.unpacked');
}
