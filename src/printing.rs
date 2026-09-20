//! A closed height-field solid: shared top, bottom and boundary vertices.
//! Coordinates are millimetres with Z up. No overlapping/floating scene meshes.
use crate::material_catalog::BASE_COLOR;
use crate::Project;

const SAMPLES: usize = 4;
pub const HEIGHTS: [f32; 12] = [
    0.6, 0.18, 0.9, 2.8, 0.35, 0.5, 0.4, 0.65, 0.3, 0.2, 0.6, 0.5,
];

#[derive(serde::Serialize)]
struct Mesh {
    vertices: Vec<[f32; 3]>,
    faces: Vec<[usize; 3]>,
    colors: Vec<u16>,
}
impl Mesh {
    fn quad(&mut self, a: usize, b: usize, c: usize, d: usize) {
        self.faces.extend([[a, b, c], [a, c, d]]);
        self.colors.extend([BASE_COLOR, BASE_COLOR]);
    }
    fn stl(&self) -> Vec<u8> {
        let mut bytes = vec![0u8; 80];
        let header = b"DND Campaign Building | terrain relief | coordinates in millimetres";
        bytes[..header.len()].copy_from_slice(header);
        bytes.extend_from_slice(&(self.faces.len() as u32).to_le_bytes());
        for f in &self.faces {
            let [a, b, c] = f.map(|i| self.vertices[i]);
            let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let n = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ];
            let length = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            for value in n.map(|x| x / length).into_iter().chain(a).chain(b).chain(c) {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            bytes.extend_from_slice(&0u16.to_le_bytes());
        }
        bytes
    }
}

fn mesh(
    project: &Project,
    width_mm: f32,
    base_mm: f32,
    relief: f32,
    trees: bool,
    pins: bool,
) -> Result<Mesh, String> {
    mesh_region(
        project,
        width_mm,
        base_mm,
        relief,
        trees,
        pins,
        0,
        0,
        project.width,
        project.height,
    )
}

fn mesh_region(
    project: &Project,
    width_mm: f32,
    base_mm: f32,
    relief: f32,
    trees: bool,
    pins: bool,
    start_x: usize,
    start_y: usize,
    width: usize,
    height: usize,
) -> Result<Mesh, String> {
    if !width_mm.is_finite()
        || !(0.5..=2000.0).contains(&width_mm)
        || !base_mm.is_finite()
        || !(1.0..=10.0).contains(&base_mm)
        || !relief.is_finite()
        || !(0.25..=3.0).contains(&relief)
    {
        return Err(
            "Use a width of 0.5–2000 mm, a base of 1–10 mm, and a terrain height scale of 0.25–3."
                .into(),
        );
    }
    let nx = width * SAMPLES;
    let ny = height * SAMPLES;
    let count = (nx + 1) * (ny + 1);
    let tile_mm = width_mm / width as f32;
    let mut result = Mesh {
        vertices: Vec::with_capacity(count * 2),
        faces: Vec::with_capacity(nx * ny * 4 + (nx + ny) * 4),
        colors: Vec::with_capacity(nx * ny * 4 + (nx + ny) * 4),
    };
    let mut locations = vec![false; project.tiles.len()];
    if pins {
        for p in &project.pins {
            locations[p.y * project.width + p.x] = true;
        }
    }
    let mut surface: Vec<f32> = project
        .tiles
        .iter()
        .enumerate()
        .map(|(i, t)| HEIGHTS[*t as usize] + project.elevations[i] as f32)
        .collect();
    let mut surface_colors: Vec<u16> = project.tiles.iter().map(|v| *v as u16).collect();
    for b in &project.blocks {
        let i = b.y * project.width + b.x;
        if b.z as f32 + 1.0 >= surface[i] {
            surface[i] = b.z as f32 + 1.0;
            surface_colors[i] = 12 + b.material;
        }
    }
    let terrain = |x: isize, y: isize| -> f32 {
        let x = x.clamp(0, project.width as isize - 1) as usize;
        let y = y.clamp(0, project.height as isize - 1) as usize;
        surface[y * project.width + x]
    };
    for j in 0..=ny {
        for i in 0..=nx {
            let x = i as f32 / SAMPLES as f32 + start_x as f32;
            // Reverse map rows so the top of the 2D map points toward +Y.
            let y = (ny - j) as f32 / SAMPLES as f32 + start_y as f32;
            let lx = (x - 0.5).floor();
            let ly = (y - 0.5).floor();
            let fx = x - 0.5 - lx;
            let fy = y - 0.5 - ly;
            let a = terrain(lx as isize, ly as isize);
            let b = terrain(lx as isize + 1, ly as isize);
            let c = terrain(lx as isize, ly as isize + 1);
            let d = terrain(lx as isize + 1, ly as isize + 1);
            let h = (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (c * (1.0 - fx) + d * fx) * fy;
            let cx = (x.floor() as usize).min(project.width - 1);
            let cy = (y.floor() as usize).min(project.height - 1);
            let tile = cy * project.width + cx;
            let radius = ((x - cx as f32 - 0.5).powi(2) + (y - cy as f32 - 0.5).powi(2)).sqrt();
            let tree = if trees && project.tiles[tile] == 2 && surface_colors[tile] < 12 {
                (1.0 - radius / 0.35).max(0.0) * 1.1
            } else {
                0.0
            };
            // Low, solid markers, avoiding floating pins and thin stems.
            let pin = if locations[tile] {
                (1.0 - radius / 0.4).clamp(0.0, 0.75) * 1.2
            } else {
                0.0
            };
            result.vertices.push([
                i as f32 / SAMPLES as f32 * tile_mm,
                j as f32 / SAMPLES as f32 * tile_mm,
                base_mm + (h + tree.max(pin)) * tile_mm * relief,
            ]);
        }
    }
    for i in 0..count {
        let p = result.vertices[i];
        result.vertices.push([p[0], p[1], 0.0]);
    }
    let vertex = |x: usize, y: usize| y * (nx + 1) + x;
    for y in 0..ny {
        for x in 0..nx {
            let a = vertex(x, y);
            let b = vertex(x + 1, y);
            let c = vertex(x + 1, y + 1);
            let d = vertex(x, y + 1);
            result.quad(a, b, c, d);
            let gx = start_x as f32 + (x as f32 + 0.5) / SAMPLES as f32;
            let gy = start_y as f32 + height as f32 - (y as f32 + 0.5) / SAMPLES as f32;
            let tx = (gx.floor() as usize).min(project.width - 1);
            let ty = (gy.floor() as usize).min(project.height - 1);
            let mut color = surface_colors[ty * project.width + tx];
            if pins
                && locations[ty * project.width + tx]
                && (gx - tx as f32 - 0.5).hypot(gy - ty as f32 - 0.5) < 0.3
            {
                color = 29;
            }
            let n = result.colors.len();
            result.colors[n - 2] = color;
            result.colors[n - 1] = color;
            result.quad(a + count, d + count, c + count, b + count);
        }
    }
    for x in 0..nx {
        let a = vertex(x, 0);
        let b = vertex(x + 1, 0);
        result.quad(a + count, b + count, b, a);
        let a = vertex(x + 1, ny);
        let b = vertex(x, ny);
        result.quad(a + count, b + count, b, a);
    }
    for y in 0..ny {
        let a = vertex(0, y + 1);
        let b = vertex(0, y);
        result.quad(a + count, b + count, b, a);
        let a = vertex(nx, y);
        let b = vertex(nx, y + 1);
        result.quad(a + count, b + count, b, a);
    }
    Ok(result)
}

pub fn export(
    project: &Project,
    width_mm: f32,
    base_mm: f32,
    relief: f32,
    trees: bool,
    pins: bool,
) -> Result<Vec<u8>, String> {
    project.validate()?;
    Ok(mesh(project, width_mm, base_mm, relief, trees, pins)?.stl())
}

fn section_mesh(
    project: &Project,
    tile_mm: f32,
    base_mm: f32,
    relief: f32,
    trees: bool,
    pins: bool,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> Result<Mesh, String> {
    project.validate()?;
    if width == 0
        || height == 0
        || x >= project.width
        || y >= project.height
        || width > project.width - x
        || height > project.height - y
        || !tile_mm.is_finite()
        || !(0.1..=50.0).contains(&tile_mm)
    {
        return Err("Invalid print section or tile size (0.1–50 mm).".into());
    }
    mesh_region(
        project,
        tile_mm * width as f32,
        base_mm,
        relief,
        trees,
        pins,
        x,
        y,
        width,
        height,
    )
}

pub fn export_section(
    project: &Project,
    tile_mm: f32,
    base_mm: f32,
    relief: f32,
    trees: bool,
    pins: bool,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> Result<Vec<u8>, String> {
    Ok(section_mesh(
        project, tile_mm, base_mm, relief, trees, pins, x, y, width, height,
    )?
    .stl())
}
pub fn export_model(
    project: &Project,
    tile_mm: f32,
    base_mm: f32,
    relief: f32,
    trees: bool,
    pins: bool,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> Result<String, String> {
    serde_json::to_string(&section_mesh(
        project, tile_mm, base_mm, relief, trees, pins, x, y, width, height,
    )?)
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Pin, Realm};
    use std::collections::{HashMap, HashSet};
    fn verify(m: &Mesh) {
        let mut edges: HashMap<(usize, usize), (usize, i32)> = HashMap::new();
        let mut volume = 0.0f64;
        for face in &m.faces {
            let [a, b, c] = face.map(|i| m.vertices[i].map(f64::from));
            let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let cross = [
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            ];
            assert!(
                cross.iter().map(|v| v * v).sum::<f64>() > 1e-12,
                "degenerate triangle"
            );
            volume += (a[0] * (b[1] * c[2] - b[2] * c[1])
                + a[1] * (b[2] * c[0] - b[0] * c[2])
                + a[2] * (b[0] * c[1] - b[1] * c[0]))
                / 6.0;
            for [a, b] in [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] {
                let e = edges.entry((a.min(b), a.max(b))).or_default();
                e.0 += 1;
                e.1 += if a < b { 1 } else { -1 };
            }
        }
        assert!(volume > 0.0, "outward orientation");
        assert!(
            edges.values().all(|e| *e == (2, 0)),
            "closed consistently wound two-manifold mesh"
        );
        assert_eq!(
            m.vertices.len() as isize - edges.len() as isize + m.faces.len() as isize,
            2
        );
        let mut visited = HashSet::new();
        let mut stack = vec![0usize];
        let mut adjacent = vec![Vec::new(); m.vertices.len()];
        for &(a, b) in edges.keys() {
            adjacent[a].push(b);
            adjacent[b].push(a);
        }
        while let Some(v) = stack.pop() {
            if visited.insert(v) {
                stack.extend(adjacent[v].iter().copied());
            }
        }
        assert_eq!(visited.len(), m.vertices.len(), "one connected solid");
    }
    #[test]
    fn flat_solid_dimensions() {
        let m = mesh(&Project::default(), 180.0, 2.0, 1.0, false, false).unwrap();
        verify(&m);
        let max = |axis| m.vertices.iter().map(|v| v[axis]).fold(0.0, f32::max);
        assert_eq!(max(0), 180.0);
        assert_eq!(max(1), 126.0);
        assert!((max(2) - 4.7).abs() < 1e-5);
    }
    #[test]
    fn island_and_features_are_watertight() {
        let mut r = Realm::new();
        r.generate(42);
        r.project.pins.push(Pin {
            x: 0,
            y: 0,
            name: "Corner".into(),
            notes: "".into(),
        });
        r.project.pins.push(Pin {
            x: 20,
            y: 14,
            name: "Center".into(),
            notes: "".into(),
        });
        for options in [(false, false), (true, false), (true, true)] {
            verify(&mesh(&r.project, 200.0, 2.0, 1.5, options.0, options.1).unwrap());
        }
    }
    #[test]
    fn alternating_extreme_terrain_remains_manifold() {
        let mut p = Project::default();
        for y in 0..p.height {
            for x in 0..p.width {
                p.tiles[y * p.width + x] = if (x + y) % 2 == 0 { 1 } else { 3 };
            }
        }
        verify(&mesh(&p, 40.0, 1.0, 3.0, true, true).unwrap());
    }
    #[test]
    fn binary_stl_is_complete() {
        let data = export(&Project::default(), 180.0, 2.0, 1.0, true, true).unwrap();
        let n = u32::from_le_bytes(data[80..84].try_into().unwrap()) as usize;
        assert_eq!(data.len(), 84 + n * 50);
        assert!(n > 0);
        for face in data[84..].chunks_exact(50) {
            for f in face[..48].chunks_exact(4) {
                assert!(f32::from_le_bytes(f.try_into().unwrap()).is_finite());
            }
        }
    }
    #[test]
    fn refuses_bad_dimensions() {
        let p = Project::default();
        for args in [
            (0.0, 2.0, 1.0),
            (180.0, 0.0, 1.0),
            (180.0, 2.0, f32::NAN),
            (f32::INFINITY, 2.0, 1.0),
        ] {
            assert!(export(&p, args.0, args.1, args.2, true, true).is_err());
        }
    }
    #[test]
    fn features_change_only_the_top() {
        let mut p = Project::default();
        p.tiles[20 * 40 + 10] = 2;
        p.pins.push(Pin {
            x: 5,
            y: 5,
            name: "Town".into(),
            notes: "".into(),
        });
        let a = mesh(&p, 180.0, 2.0, 1.0, false, false).unwrap();
        let b = mesh(&p, 180.0, 2.0, 1.0, true, true).unwrap();
        assert_eq!(a.faces, b.faces);
        assert!(a.vertices.iter().zip(&b.vertices).any(|(a, b)| a[2] < b[2]));
        for (a, b) in a.vertices.iter().zip(&b.vertices) {
            assert_eq!(a[..2], b[..2]);
            assert!(b[2] >= a[2]);
        }
    }
    #[test]
    fn sections_share_identical_seams_and_have_colors() {
        let mut r = Realm::new();
        r.generate(37);
        r.place_block(7, 4, 8, 17);
        let left = section_mesh(&r.project, 25.4, 2.0, 1.0, true, true, 0, 0, 8, 8).unwrap();
        let right = section_mesh(&r.project, 25.4, 2.0, 1.0, true, true, 8, 0, 8, 8).unwrap();
        verify(&left);
        verify(&right);
        for y in 0..=32 {
            assert_eq!(left.vertices[y * 33 + 32][2], right.vertices[y * 33][2]);
        }
        assert_eq!(left.colors.len(), left.faces.len());
        assert!(left.colors.contains(&29));
        assert!(left.colors.iter().all(|c| *c <= BASE_COLOR));
    }
}
