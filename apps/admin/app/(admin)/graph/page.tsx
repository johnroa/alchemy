import { PageHeader } from "@/components/admin/page-header";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getGraphData } from "@/lib/admin-data";

export default async function GraphPage(): Promise<React.JSX.Element> {
  const graph = await getGraphData();

  return (
    <div className="space-y-6">
      <PageHeader title="Graph Inspector" description="Typed relational graph entities and edges." />
      <Card>
        <CardHeader>
          <CardTitle>Entity Catalog</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {graph.entities.slice(0, 15).map((entity) => (
                <TableRow key={entity.id}>
                  <TableCell>{entity.label}</TableCell>
                  <TableCell><Badge variant="outline">{entity.entity_type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{entity.id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Edge Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            <AccordionItem value="edges">
              <AccordionTrigger>Show edge details</AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {graph.edges.slice(0, 20).map((edge) => (
                      <TableRow key={edge.id}>
                        <TableCell className="font-mono text-xs">{edge.from_entity_id}</TableCell>
                        <TableCell className="font-mono text-xs">{edge.to_entity_id}</TableCell>
                        <TableCell>{edge.confidence.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
