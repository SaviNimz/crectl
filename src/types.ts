export interface WSO2Process {
  pid: number;
  etime: string;
  cpu: number;
  mem: number;
  rss: number; // KB
  product: string;
  version: string;
  carbonHome: string;
  command: string;
  ports: number[];
}

export interface WSO2Container {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
}
