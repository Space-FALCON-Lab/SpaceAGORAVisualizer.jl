# Extracted from SpaceAGORA SceneVisualization at the commit in NOTICE.
# Module inventories, import-map construction and HTML substitution retain the
# original implementation. Input contract validation lives in the public wrapper.
const VIEWER_DIR = normpath(joinpath(@__DIR__, "..", "viewer"))
const VIEWER_MODULES = ("data.js", "colormaps.js", "globe.js", "atmosphere.js", "spacecraft.js", "lod.js", "ensemble.js", "paths.js", "links.js", "references.js", "groundtrack.js", "video.js", "plots.js", "terrain.js", "plumes.js", "timeline.js", "dust.js", "lighting.js", "ui.js", "main.js")
const VIEWER_VENDOR = (
    "three" => joinpath("vendor", "three.module.js"),
    "three/addons/controls/OrbitControls.js" => joinpath("vendor", "OrbitControls.js"),
    "three/addons/loaders/STLLoader.js" => joinpath("vendor", "STLLoader.js"),
    "three/addons/loaders/OBJLoader.js" => joinpath("vendor", "OBJLoader.js"),
    "three/addons/loaders/GLTFLoader.js" => joinpath("vendor", "GLTFLoader.js"),
    "three/addons/utils/BufferGeometryUtils.js" => joinpath("vendor", "BufferGeometryUtils.js"),
    "mp4-muxer" => joinpath("vendor", "mp4-muxer.mjs"),
)
@inline _js_data_url(source::AbstractString)::String = "data:text/javascript;base64," * base64encode(Vector{UInt8}(codeunits(String(source))))

function viewer_import_map(viewer_dir::AbstractString=VIEWER_DIR)::Dict{String, Any}
    imports = Dict{String, String}()
    for (specifier, rel) in VIEWER_VENDOR
        path = joinpath(viewer_dir, rel)
        isfile(path) || throw(ArgumentError("Missing vendored viewer module $(path)."))
        imports[specifier] = _js_data_url(read(path, String))
    end
    for name in VIEWER_MODULES
        path = joinpath(viewer_dir, "src", name)
        isfile(path) || throw(ArgumentError("Missing viewer module $(path)."))
        imports["viewer/" * name] = _js_data_url(read(path, String))
    end
    return Dict{String, Any}("imports" => imports)
end

# JSON embedded in a <script> must never contain the sequence "</" (it would
# close the tag); "<\/" is the same JSON string.
@inline _script_safe_json(value)::String = replace(JSON.json(value), "</" => "<\\/")

function _render_viewer_html(payload::AbstractDict; viewer_dir::AbstractString=VIEWER_DIR, title::AbstractString="SpaceAGORA viewer")::String
    template_path = joinpath(viewer_dir, "template.html")
    isfile(template_path) || throw(ArgumentError("Missing viewer template $(template_path)."))
    html = read(template_path, String)
    for token in ("__TITLE__", "__IMPORTMAP__", "__PAYLOAD__")
        occursin(token, html) || throw(ArgumentError("Viewer template is missing the $(token) placeholder."))
    end
    safe_title = replace(String(title), "<" => "&lt;", ">" => "&gt;", "&" => "&amp;")
    html = replace(html, "__TITLE__" => safe_title)
    html = replace(html, "__IMPORTMAP__" => _script_safe_json(viewer_import_map(viewer_dir)))
    return replace(html, "__PAYLOAD__" => _script_safe_json(payload))
end

