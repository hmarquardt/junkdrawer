// Pure archive intake report. Accepts plain adapter metadata so it is testable without a DOM.
export function archiveReport({ archiveBytes = 0, metadata = {}, recovery = {}, assets = [] }) {
  const images = (metadata.images || []).map((image, index) => ({
    order: index + 1,
    label: image.label || 'Archive image ' + (index + 1),
    mime: image.mime || '',
    bytes: image.bytes ?? null,
    cid: image.cid || '',
    location: image.location || '',
    partIndex: image.partIndex ?? null,
    labelSide: image.side || null,
    dimensions: assets[index]?.width && assets[index]?.height
      ? assets[index].width + ' × ' + assets[index].height
      : null,
    assignedSide: assets[index]?.assignedSide || null,
  }));
  const assignments = Object.fromEntries(
    ['Left', 'Right'].map((side) => {
      const match = images.find((image) => image.assignedSide === side);
      return [side, match ? match.label : null];
    }),
  );
  const ambiguities = [
    ...images
      .filter((image) => image.labelSide === 'ambiguous' || !image.assignedSide)
      .map((image) =>
        image.labelSide === 'ambiguous'
          ? image.label + ' has conflicting Left/Right labels.'
          : image.label + ' is not assigned to a candidate.',
      ),
    ...(recovery.warnings || []).filter((warning) =>
      /assignment|ambiguous|recoverable|multiple|not identified/i.test(warning),
    ),
  ];
  return {
    archiveBytes,
    mimeParts: metadata.mimeParts ?? null,
    htmlDocuments: metadata.htmlParts ?? null,
    imageResources: images.length,
    embeddedImages: metadata.embeddedImages ?? images.length,
    rootLocation: metadata.rootLocation || '',
    images,
    assignments,
    requestCandidates: recovery.requests || [],
    recoveredRequest: (recovery.requests || []).length === 1 ? recovery.requests[0] : null,
    ambiguities: [...new Set(ambiguities)],
    warnings: [...new Set(recovery.warnings || [])],
  };
}
