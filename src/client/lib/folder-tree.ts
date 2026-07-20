import type { Folder } from "../../shared/types";

export interface FolderTreeNode {
  path: string;
  name: string;
  folder: Folder | null;
  messageCount: number;
  children: FolderTreeNode[];
}

export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  const roots: FolderTreeNode[] = [];
  const nodes = new Map<string, FolderTreeNode>();

  for (const folder of folders) {
    const delimiter = folder.delimiter || inferDelimiter(folder);
    const segments = delimiter ? folder.path.split(delimiter).filter(Boolean) : [folder.path];
    if (!segments.length) continue;

    let parent: FolderTreeNode | null = null;
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath && delimiter ? `${currentPath}${delimiter}${segment}` : segment;
      let node = nodes.get(currentPath);
      if (!node) {
        node = { path: currentPath, name: segment, folder: null, messageCount: 0, children: [] };
        nodes.set(currentPath, node);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      parent = node;
    }

    if (parent) {
      parent.folder = folder;
      parent.name = folder.name || parent.name;
      parent.messageCount = folder.messageCount;
    }
  }

  finalizeTree(roots);
  return roots;
}

function inferDelimiter(folder: Folder): string | null {
  if (folder.parentPath && folder.path.startsWith(folder.parentPath)) {
    const candidate = folder.path.slice(folder.parentPath.length, folder.parentPath.length + 1);
    if (candidate) return candidate;
  }
  return folder.path.includes("/") ? "/" : null;
}

function finalizeTree(nodes: FolderTreeNode[]): number {
  nodes.sort(compareNodes);
  let total = 0;
  for (const node of nodes) {
    const childCount = finalizeTree(node.children);
    if (!node.folder) node.messageCount = childCount;
    total += node.folder ? node.folder.messageCount : childCount;
  }
  return total;
}

function compareNodes(left: FolderTreeNode, right: FolderTreeNode): number {
  const rankDifference = specialUseRank(left.folder?.specialUse) - specialUseRank(right.folder?.specialUse);
  return rankDifference || left.name.localeCompare(right.name, "de", { numeric: true, sensitivity: "base" });
}

function specialUseRank(value: string | null | undefined): number {
  switch (value) {
    case "\\Inbox": return 0;
    case "\\Sent": return 1;
    case "\\Drafts": return 2;
    case "\\Archive": return 3;
    case "\\All": return 4;
    default: return 10;
  }
}
