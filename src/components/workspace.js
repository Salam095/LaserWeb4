// Copyright 2016 Todd Fleming
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mat4, vec3, vec4 } from 'gl-matrix';
import React from 'react'
import { connect } from 'react-redux'
import ReactDOM from 'react-dom';

import { resetCamera, setCameraAttrs } from '../actions/camera'
import { selectDocument, toggleSelectDocument, scaleTranslateSelectedDocuments, translateSelectedDocuments } from '../actions/document';
import { setWorkspaceAttrs } from '../actions/workspace';

import Capture from './capture';
import { withDocumentCache } from './document-cache'
import { Dom3d, Text3d } from './dom3d';
import DrawCommands from '../draw-commands'
import { GcodePreview } from '../draw-commands/GcodePreview'
import { LaserPreview } from '../draw-commands/LaserPreview'
import { convertOutlineToThickLines } from '../draw-commands/thick-lines'
import { Input } from './forms.js';
import SetSize from './setsize';
import { parseGcode } from '../lib/tmpParseGcode';

import CommandHistory from './command-history'

function camera({viewportWidth, viewportHeight, fovy, near, far, eye, center, up, showPerspective}) {
    let perspective;
    let view = mat4.lookAt([], eye, center, up);
    if (showPerspective)
        perspective = mat4.perspective([], fovy, viewportWidth / viewportHeight, near, far);
    else {
        let yBound = vec3.distance(eye, center) * Math.tan(fovy / 2);
        perspective = mat4.identity([]);
        view = mat4.mul([],
            mat4.ortho([], -yBound * viewportWidth / viewportHeight, yBound * viewportWidth / viewportHeight, -yBound, yBound, near, far),
            view);
        fovy = 0;
    }
    let viewInv = mat4.invert([], view);
    return { fovy, perspective, view, viewInv };
}

class Grid {
    draw(drawCommands, {width, height}) {
        if (!this.position || this.width !== width || this.height !== height) {
            this.width = width;
            this.height = height;
            let a = [];
            a.push(0, 0, 0, this.width, 0, 0);
            a.push(0, 0, 0, 0, this.height, 0);
            for (let x = 10; x < this.width; x += 10)
                a.push(x, 0, 0, x, this.height, 0);
            a.push(this.width, 0, 0, this.width, this.height, 0);
            for (let y = 10; y < this.height; y += 10)
                a.push(0, y, 0, this.width, y, 0);
            a.push(0, this.height, 0, this.width, this.height, 0);
            if (this.position)
                this.position.destroy();
            this.position = drawCommands.regl.buffer(new Float32Array(a));
            this.count = a.length / 3;
        }
        drawCommands.simple({ position: this.position, offset: 4, count: this.count - 4, color: [0.7, 0.7, 0.7, 0.95], scale: [1, 1, 1], translate: [0, 0, 0], primitive: 'lines' }); // Gray grid
        drawCommands.simple({ position: this.position, offset: 0, count: 2, color: [0.6, 0, 0, 1], scale: [1, 1, 1], translate: [0, 0, 0], primitive: 'lines' }); // Red
        drawCommands.simple({ position: this.position, offset: 2, count: 2, color: [0, 0.8, 0, 1], scale: [1, 1, 1], translate: [0, 0, 0], primitive: 'lines' }); // Green
    }
};

function GridText(props) {
    let a = [];
    for (let x = 50; x <= props.width; x += 50)
        a.push(<Text3d key={'x' + x} x={x} y={-5} size={10} style={{ color: '#CC0000' }}>{x}</Text3d>);
    a.push(<Text3d key="x-label" x={props.width + 15} y={0} size={10} style={{ color: '#CC0000' }}>X</Text3d>);
    for (let y = 50; y <= props.height; y += 50)
        a.push(<Text3d key={'y' + y} x={-10} y={y} size={10} style={{ color: '#00CC00' }}>{y}</Text3d>);
    a.push(<Text3d key="y-label" x={0} y={props.height + 15} size={10} style={{ color: '#00CC00' }}>Y</Text3d>);
    return <div>{a}</div>;
}

class FloatingControls extends React.Component {
    componentWillMount() {
        this.state = { linkScale: true };
        this.linkScaleChanged = e => {
            this.setState({ linkScale: e.target.checked });
        }
        this.scale = (sx, sy) => {
            let cx = (this.bounds.x1 + this.bounds.x2) / 2;
            let cy = (this.bounds.y1 + this.bounds.y2) / 2;
            this.props.dispatch(scaleTranslateSelectedDocuments(
                [sx, sy, 1],
                [cx - sx * cx, cy - sy * cy, 0]
            ));
        }
        this.setMinX = v => {
            this.props.dispatch(translateSelectedDocuments([v - this.bounds.x1, 0, 0]));
        }
        this.setCenterX = v => {
            this.props.dispatch(translateSelectedDocuments([v - (this.bounds.x1 + this.bounds.x2) / 2, 0, 0]));
        }
        this.setMaxX = v => {
            this.props.dispatch(translateSelectedDocuments([v - this.bounds.x2, 0, 0]));
        }
        this.setSizeX = v => {
            if (v > 0 && this.bounds.x2 - this.bounds.x1 > 0) {
                let s = v / (this.bounds.x2 - this.bounds.x1);
                if (this.state.linkScale)
                    this.scale(s, s);
                else
                    this.scale(s, 1);
            }
        }
        this.setMinY = v => {
            this.props.dispatch(translateSelectedDocuments([0, v - this.bounds.y1, 0]));
        }
        this.setCenterY = v => {
            this.props.dispatch(translateSelectedDocuments([0, v - (this.bounds.y1 + this.bounds.y2) / 2, 0]));
        }
        this.setMaxY = v => {
            this.props.dispatch(translateSelectedDocuments([0, v - this.bounds.y2, 0]));
        }
        this.setSizeY = v => {
            if (v > 0 && this.bounds.y2 - this.bounds.y1 > 0) {
                let s = v / (this.bounds.y2 - this.bounds.y1);
                if (this.state.linkScale)
                    this.scale(s, s);
                else
                    this.scale(1, s);
            }
        }
    }

    render() {
        let found = false;
        let bounds = this.bounds = { x1: Number.MAX_VALUE, y1: Number.MAX_VALUE, x2: Number.MIN_VALUE, y2: Number.MIN_VALUE };
        for (let cache of this.props.documentCacheHolder.cache.values()) {
            let doc = cache.document;
            if (doc.selected && doc.translate && cache.bounds) {
                found = true;
                bounds.x1 = Math.min(bounds.x1, doc.scale[0] * cache.bounds.x1 + doc.translate[0]);
                bounds.y1 = Math.min(bounds.y1, doc.scale[1] * cache.bounds.y1 + doc.translate[1]);
                bounds.x2 = Math.max(bounds.x2, doc.scale[0] * cache.bounds.x2 + doc.translate[0]);
                bounds.y2 = Math.max(bounds.y2, doc.scale[1] * cache.bounds.y2 + doc.translate[1]);
            }
        }
        if (!found || !this.props.camera)
            return <div />

        let p =
            vec4.transformMat4([],
                vec4.transformMat4([], [bounds.x1, bounds.y1, 0, 1], this.props.camera.view),
                this.props.camera.perspective);
        let x = (p[0] / p[3] + 1) * this.props.workspaceWidth / 2;
        let y = this.props.workspaceHeight - (p[1] / p[3] + 1) * this.props.workspaceHeight / 2;

        x = x / window.devicePixelRatio - this.props.width;
        y = y / window.devicePixelRatio;
        x = Math.min(Math.max(x, 0), this.props.workspaceWidth / window.devicePixelRatio - this.props.width);
        y = Math.min(Math.max(y, 0), this.props.workspaceHeight / window.devicePixelRatio - this.props.height);

        let round = n => Math.round(n * 100) / 100;

        return (
            <table style={{ position: 'relative', left: x, top: y, border: '2px solid #ccc', margin: '1px', padding: '2px', backgroundColor: '#eee'  }} className="floating-controls" >
                <tr>
                    <td></td>
                    <td>Min</td>
                    <td>Center</td>
                    <td>Max</td>
                    <td>Size</td>
                    <td></td>
                </tr>
                <tr>
                    <td><span className="label label-danger">X</span></td>
                    <td><Input value={round(bounds.x1)} onChangeValue={this.setMinX} type="number" step="any" /></td>
                    <td><Input value={round((bounds.x1 + bounds.x2) / 2)} onChangeValue={this.setCenterX} type="number" step="any" /></td>
                    <td><Input value={round(bounds.x2)} type="number" onChangeValue={this.setMaxX} step="any" /></td>
                    <td><Input value={round(bounds.x2 - bounds.x1)} type="number" onChangeValue={this.setSizeX} step="any" /></td>
                    <td rowSpan={2}>
                        &#x2511;<br /><input type="checkbox" checked={this.state.linkScale} onChange={this.linkScaleChanged} /><br />&#x2519;
                    </td>
                </tr>
                <tr>
                    <td><span className="label label-success">Y</span></td>
                    <td><Input value={round(bounds.y1)} onChangeValue={this.setMinY} type="number" step="any" /></td>
                    <td><Input value={round((bounds.y1 + bounds.y2) / 2)} onChangeValue={this.setCenterY} type="number" step="any" /></td>
                    <td><Input value={round(bounds.y2)} type="number" onChangeValue={this.setMaxY} step="any" /></td>
                    <td><Input value={round(bounds.y2 - bounds.y1)} type="number" onChangeValue={this.setSizeY} step="any" /></td>
                </tr>
            </table>
        );
    }
} // FloatingControls

const thickSquare = convertOutlineToThickLines([0, 0, 1, 0, 1, 1, 0, 1, 0, 0]);

function drawDocuments(drawCommands, documentCacheHolder) {
    for (let cachedDocument of documentCacheHolder.cache.values()) {
        let {document} = cachedDocument;
        switch (document.type) {
            case 'path':
                drawCommands.noDepth(() => {
                    drawCommands.blendAlpha(() => {
                        drawCommands.simple2d({
                            position: cachedDocument.triangles,
                            scale: document.scale,
                            translate: document.translate,
                            color: document.fillColor,
                            primitive: 'triangles',
                            offset: 0,
                            count: cachedDocument.triangles.length / 2,
                        });
                        for (let o of cachedDocument.outlines)
                            drawCommands.simple2d({
                                position: o,
                                scale: document.scale,
                                translate: document.translate,
                                color: document.strokeColor,
                                primitive: 'line strip',
                                offset: 0,
                                count: o.length / 2,
                            });
                    });
                });
                break;
            case 'image':
                if (cachedDocument.image && cachedDocument.texture && cachedDocument.regl === drawCommands.regl)
                    drawCommands.noDepth(() => {
                        drawCommands.image({
                            translate: document.translate,
                            size: [
                                cachedDocument.image.width / document.dpi * 25.4 * document.scale[0],
                                cachedDocument.image.height / document.dpi * 25.4 * document.scale[1]],
                            texture: cachedDocument.texture,
                            selected: false,
                        });
                    });
                break;
        }
    }
} // drawDocuments

function drawSelectedDocuments(drawCommands, documentCacheHolder) {
    for (let cachedDocument of documentCacheHolder.cache.values()) {
        let {document} = cachedDocument;
        if (!document.selected)
            continue;
        switch (document.type) {
            case 'path':
                drawCommands.noDepth(() => {
                    for (let o of cachedDocument.thickOutlines)
                        drawCommands.thickLines({
                            buffer: o,
                            scale: document.scale,
                            translate: document.translate,
                            thickness: 6,
                            color1: [0, 0, 1, 1],
                            color2: [1, 1, 1, 1],
                        })
                });
                break;
            case 'image':
                if (cachedDocument.image && cachedDocument.texture && cachedDocument.regl === drawCommands.regl)
                    drawCommands.noDepth(() => {
                        drawCommands.thickLines({
                            buffer: thickSquare,
                            scale: [
                                cachedDocument.image.width / document.dpi * 25.4 * document.scale[0],
                                cachedDocument.image.height / document.dpi * 25.4 * document.scale[1],
                                1],
                            translate: document.translate,
                            thickness: 6,
                            color1: [0, 0, 1, 1],
                            color2: [1, 1, 1, 1],
                        })
                    });
                break;
        }
    }
} // drawSelectedDocuments

function drawDocumentsHitTest(drawCommands, documentCacheHolder) {
    for (let cachedDocument of documentCacheHolder.cache.values()) {
        let {document, hitTestId} = cachedDocument;
        let color = [((hitTestId >> 24) & 0xff) / 0xff, ((hitTestId >> 16) & 0xff) / 0xff, ((hitTestId >> 8) & 0xff) / 0xff, (hitTestId & 0xff) / 0xff];
        if (document.type === 'path') {
            drawCommands.noDepth(() => {
                drawCommands.simple2d({
                    position: cachedDocument.triangles,
                    scale: document.scale,
                    translate: document.translate,
                    color,
                    primitive: 'triangles',
                    offset: 0,
                    count: cachedDocument.triangles.length / 2,
                });
                for (let o of cachedDocument.thickOutlines)
                    drawCommands.thickLines({
                        buffer: o,
                        scale: document.scale,
                        translate: document.translate,
                        thickness: 10,
                        color1: color,
                        color2: color,
                    })
            });
        } else if (document.type === 'image' && cachedDocument.image && cachedDocument.texture && cachedDocument.regl === drawCommands.regl) {
            drawCommands.noDepth(() => {
                let w = cachedDocument.image.width / document.dpi * 25.4;
                let h = cachedDocument.image.height / document.dpi * 25.4;
                drawCommands.simple({
                    position: [[0, 0, 0], [w, 0, 0], [w, h, 0], [w, h, 0], [0, h, 0], [0, 0, 0]],
                    scale: document.scale,
                    translate: document.translate,
                    color,
                    primitive: 'triangles',
                    offset: 0,
                    count: 6,
                });
            });
        }
    }
}

class WorkspaceContent extends React.Component {
    componentWillMount() {
        this.grid = new Grid();
        this.setCanvas = this.setCanvas.bind(this);
        this.documentCache = [];
        this.mouseDown = this.mouseDown.bind(this);
        this.mouseMove = this.mouseMove.bind(this);
        this.mouseUp = this.mouseUp.bind(this);
        this.contextMenu = this.contextMenu.bind(this);
        this.wheel = this.wheel.bind(this);
    }

    setCanvas(canvas) {
        if (this.canvas === canvas)
            return;
        this.canvas = canvas;
        if (this.regl) {
            this.regl.destroy();
            this.regl = null;
        }
        if (!canvas)
            return;

        this.regl = require('regl')({
            canvas: ReactDOM.findDOMNode(canvas),
            extensions: ['EXT_blend_minmax'],
        });
        this.hitTestFrameBuffer = this.regl.framebuffer({
            width: this.props.width,
            height: this.props.height,
        });
        this.useHitTestFrameBuffer = this.regl({ framebuffer: this.hitTestFrameBuffer })
        this.drawCommands = new DrawCommands(this.regl);
        this.props.documentCacheHolder.regl = this.regl;

        this.regl.frame(() => {
            this.regl.clear({
                color: [1, 1, 1, 1],
                depth: 1
            })
            this.drawCommands.camera({ perspective: this.camera.perspective, view: this.camera.view, }, () => {
                this.grid.draw(this.drawCommands, { width: this.props.settings.machineWidth, height: this.props.settings.machineHeight });
                if (this.props.workspace.showDocuments)
                    drawDocuments(this.drawCommands, this.props.documentCacheHolder);
                if (this.props.workspace.showLaser) {
                    this.drawCommands.noDepth(() => {
                        this.props.laserPreview.draw(this.drawCommands, {
                            diameter: this.props.settings.machineBeamDiameter,
                            gcodeSMaxValue: this.props.settings.gcodeSMaxValue,
                            g0Rate: this.props.workspace.g0Rate,
                            simTime: this.props.workspace.simTime,
                        });
                    });
                }
                if (this.props.workspace.showGcode) {
                    this.drawCommands.noDepth(() => {
                        this.props.gcodePreview.draw(this.drawCommands, this.props.workspace);
                    });
                }
                if (this.props.workspace.showDocuments)
                    drawSelectedDocuments(this.drawCommands, this.props.documentCacheHolder);
            });
            //console.log(this.regl.stats.bufferCount, this.regl.stats.cubeCount, this.regl.stats.elementsCount, this.regl.stats.framebufferCount, this.regl.stats.maxTextureUnits, this.regl.stats.renderbufferCount, this.regl.stats.shaderCount, this.regl.stats.textureCount, );
        });
    }

    componentWillReceiveProps(nextProps) {
        this.camera =
            camera({
                viewportWidth: nextProps.width,
                viewportHeight: nextProps.height,
                fovy: nextProps.camera.fovy,
                near: .1,
                far: 2000,
                eye: nextProps.camera.eye,
                center: nextProps.camera.center,
                up: nextProps.camera.up,
                showPerspective: nextProps.camera.showPerspective,
            });
    }

    rayFromPoint(pageX, pageY) {
        let r = ReactDOM.findDOMNode(this.canvas).getBoundingClientRect();
        let x = 2 * (pageX * window.devicePixelRatio - r.left) / (this.props.width) - 1;
        let y = -2 * (pageY * window.devicePixelRatio - r.top) / (this.props.height) + 1;
        if (this.props.camera.showPerspective) {
            let cursor = [x * this.props.width / this.props.height * Math.tan(this.camera.fovy / 2), y * Math.tan(this.camera.fovy / 2), -1];
            let origin = vec3.transformMat4([], [0, 0, 0], this.camera.viewInv);
            let direction = vec3.sub([], vec3.transformMat4([], cursor, this.camera.viewInv), origin);
            return { origin, direction };
        } else {
            let cursor = vec3.transformMat4([], [x, y, -1], this.camera.viewInv);
            let origin = vec3.transformMat4([], [x, y, 0], this.camera.viewInv);
            let direction = vec3.sub([], cursor, origin);
            return { origin, direction };
        }
    }

    xyInterceptFromPoint(pageX, pageY) {
        let {origin, direction} = this.rayFromPoint(pageX, pageY);
        if (!direction[2])
            return;
        let t = -origin[2] / direction[2];
        return [origin[0] + t * direction[0], origin[1] + t * direction[1], 0];
    }

    hitTest(pageX, pageY) {
        if (!this.canvas || !this.regl || !this.drawCommands)
            return;
        this.hitTestFrameBuffer.resize(this.props.width, this.props.height);

        let result;
        this.useHitTestFrameBuffer(() => {
            this.regl.clear({
                color: [0, 0, 0, 0],
                depth: 1
            })
            this.drawCommands.camera({ perspective: this.camera.perspective, view: this.camera.view, }, () => {
                if (this.props.workspace.showDocuments)
                    drawDocumentsHitTest(this.drawCommands, this.props.documentCacheHolder);
            });
            let r = ReactDOM.findDOMNode(this.canvas).getBoundingClientRect();
            let x = Math.round(pageX * window.devicePixelRatio - r.left);
            let y = Math.round(this.props.height - pageY * window.devicePixelRatio - r.top);
            if (x >= 0 && x < this.props.width && y >= 0 && y < this.props.height) {
                let pixel = this.regl.read({ x, y, width: 1, height: 1 });
                let hitTestId = (pixel[0] << 24) | (pixel[1] << 16) | (pixel[2] << 8) | pixel[3];
                for (let cachedDocument of this.props.documentCacheHolder.cache.values())
                    if (cachedDocument.hitTestId === hitTestId)
                        result = cachedDocument;
            }
        });
        return result;
    }

    mouseDown(e) {
        this.mouseX = e.pageX;
        this.mouseY = e.pageY;
        this.movingObjects = false;
        this.adjustingCamera = false;
        this.needToSelect = null;
        this.toggle = e.ctrlKey || e.shiftKey;
        this.moveStarted = false;

        let cachedDocument = this.hitTest(e.pageX, e.pageY);
        if (cachedDocument && e.button === 0) {
            this.movingObjects = true;
            if (cachedDocument.document.selected)
                this.needToSelect = cachedDocument.document.id;
            else {
                if (this.toggle)
                    this.props.dispatch(toggleSelectDocument(cachedDocument.id));
                else
                    this.props.dispatch(selectDocument(cachedDocument.id));
            }
        } else {
            this.adjustingCamera = true;
        }
    }

    mouseUp(e) {
        if (this.needToSelect) {
            if (this.toggle)
                this.props.dispatch(toggleSelectDocument(this.needToSelect));
            else
                this.props.dispatch(selectDocument(this.needToSelect));
        } else if (this.adjustingCamera && !this.moveStarted)
            this.props.dispatch(selectDocument(''));
    }

    mouseMove(e) {
        let dx = e.pageX - this.mouseX;
        let dy = this.mouseY - e.pageY;
        if (Math.abs(dx) >= 10 || Math.abs(dy) >= 10)
            this.moveStarted = true;
        if (!this.moveStarted)
            return;
        if (this.movingObjects) {
            this.needToSelect = null;
            let p1 = this.xyInterceptFromPoint(e.pageX, e.pageY);
            let p2 = this.xyInterceptFromPoint(this.mouseX, this.mouseY);
            if (p1 && p2)
                this.props.dispatch(translateSelectedDocuments(vec3.sub([], p1, p2)));
            this.mouseX = e.pageX;
            this.mouseY = e.pageY;
        } else if (this.adjustingCamera) {
            let camera = this.props.camera;
            if (e.button === 0) {
                let rot = mat4.mul([],
                    mat4.fromRotation([], dy / 200, vec3.cross([], camera.up, vec3.sub([], camera.eye, camera.center))),
                    mat4.fromRotation([], -dx / 200, camera.up));
                this.props.dispatch(setCameraAttrs({
                    eye: vec3.add([], vec3.transformMat4([], vec3.sub([], camera.eye, camera.center), rot), camera.center),
                    up: vec3.normalize([], vec3.transformMat4([], camera.up, rot)),
                }));
            } else if (e.button === 1) {
                this.props.dispatch(setCameraAttrs({
                    fovy: Math.max(.1, Math.min(Math.PI - .1, camera.fovy * Math.exp(-dy / 200))),
                }));
            } else if (e.button === 2) {
                let n = vec3.normalize([], vec3.cross([], camera.up, vec3.sub([], camera.eye, camera.center)));
                this.props.dispatch(setCameraAttrs({
                    eye: vec3.add([], camera.eye,
                        vec3.add([], vec3.scale([], n, -dx), vec3.scale([], camera.up, -dy))),
                    center: vec3.add([], camera.center,
                        vec3.add([], vec3.scale([], n, -dx), vec3.scale([], camera.up, -dy))),
                }));
            }
            this.mouseX = e.pageX;
            this.mouseY = e.pageY;
        }
    }

    wheel(e) {
        let camera = this.props.camera;
        this.props.dispatch(setCameraAttrs({
            fovy: Math.max(.1, Math.min(Math.PI - .1, camera.fovy * Math.exp(e.deltaY / 2000))),
        }));
    }

    contextMenu(e) {
        e.preventDefault();
    }

    render() {
        return (
            <div>
                <Capture
                    onMouseDown={this.mouseDown} onMouseUp={this.mouseUp}
                    onMouseMove={this.mouseMove} onContextMenu={this.contextMenu} onWheel={this.wheel}>
                    <div className="workspace-content">
                        <canvas
                            style={{ width: this.props.width, height: this.props.height }}
                            width={Math.round(this.props.width)}
                            height={Math.round(this.props.height)}
                            ref={this.setCanvas} />
                    </div>
                    <Dom3d className="workspace-content workspace-overlay" camera={this.camera} width={this.props.width} height={this.props.height}>
                        <GridText {...{ width: this.props.settings.machineWidth, height: this.props.settings.machineHeight }} />
                    </Dom3d>
                </Capture>
                <div className="workspace-content workspace-overlay" style={{ zoom: window.devicePixelRatio }}>
                    <SetSize style={{ display: 'inline-block', pointerEvents: 'all' }}>
                        <FloatingControls
                            documents={this.props.documents} documentCacheHolder={this.props.documentCacheHolder} camera={this.camera}
                            workspaceWidth={this.props.width} workspaceHeight={this.props.height} dispatch={this.props.dispatch} />
                    </SetSize>
                </div>
            </div>
        );
    }
} // WorkspaceContent

WorkspaceContent = connect(
    state => ({ settings: state.settings, documents: state.documents, camera: state.camera, workspace: state.workspace })
)(withDocumentCache(WorkspaceContent));

class Workspace extends React.Component {
    componentWillMount() {
        this.gcodePreview = new GcodePreview();
        this.laserPreview = new LaserPreview();
        this.setSimTime = e => {
            let {workspace} = this.props;
            if (e.target.value >= this.gcodePreview.g1Time + this.gcodePreview.g0Dist / workspace.g0Rate - .00001)
                this.props.dispatch(setWorkspaceAttrs({ simTime: 1e10 }));
            else
                this.props.dispatch(setWorkspaceAttrs({ simTime: +e.target.value }));
        };
    }

    render() {
        let {camera, gcode, workspace, setG0Rate, setShowPerspective, setShowGcode, setShowLaser, setShowDocuments} = this.props;
        if (this.gcode !== gcode) {
            this.gcode = gcode;
            let parsedGcode = parseGcode(gcode);
            this.gcodePreview.setParsedGcode(parsedGcode);
            this.laserPreview.setParsedGcode(parsedGcode);
        }
        return (
            <div id="workspace" className="full-height" style={this.props.style}>
                <SetSize id="workspace-top" style={{ zoom: 'reset' }}>
                    <WorkspaceContent gcodePreview={this.gcodePreview} laserPreview={this.laserPreview} />
                </SetSize>
                <div id="workspace-controls">
                    <div style={{ display: 'flex' }}>
                        <table>
                            <tbody>
                                <tr>
                                    <td colSpan='2'><button className='btn btn-default btn-block' style={{ width: '150px'}}   onClick={this.props.reset}><i className="fa fa-fw fa-search"></i>Reset View</button></td>
                                </tr>
                                <tr>
                                    <td>Perspective</td>
                                    <td><input checked={camera.showPerspective} onChange={setShowPerspective} type="checkbox" /></td>
                                </tr>
                                <tr>
                                    <td>Show Gcode</td>
                                    <td><input checked={workspace.showGcode} onChange={setShowGcode} type="checkbox" /></td>
                                </tr>
                                <tr>
                                    <td>Show Laser</td>
                                    <td><input checked={workspace.showLaser} onChange={setShowLaser} type="checkbox" /></td>
                                </tr>
                                <tr>
                                    <td>Show Documents</td>
                                    <td><input checked={workspace.showDocuments} onChange={setShowDocuments} type="checkbox" /></td>
                                </tr>
                            </tbody>
                        </table>
                        <table style={{ marginLeft: 10 }}>
                            <tbody>
                                <tr>
                                    <td>
                                      <div className='input-group'>
                                        <span className='input-group-addon'>Simulator</span>
                                        <input style={{ width: '250px'}}  class='form-control' value={workspace.simTime} onChange={this.setSimTime} type="range" step="any" max={this.gcodePreview.g1Time + this.gcodePreview.g0Dist / workspace.g0Rate} is glyphicon="transfer" />
                                        <span className='input-group-addon'>G0 Feedrate</span>
                                        <input style={{ width: '85px'}} className='form-control' value={workspace.g0Rate} onChangeValue={setG0Rate} type="number" step="any" />
                                        <span className='input-group-addon'>mm/min</span>
                                      </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <CommandHistory />
                </div>

            </div>
        )
    }
}
Workspace = connect(
    state => ({ camera: state.camera, gcode: state.gcode, workspace: state.workspace }),
    dispatch => ({
        dispatch,
        reset: () => dispatch(resetCamera()),
        setG0Rate: v => dispatch(setWorkspaceAttrs({ g0Rate: v })),
        setShowPerspective: e => dispatch(setCameraAttrs({ showPerspective: e.target.checked })),
        setShowGcode: e => dispatch(setWorkspaceAttrs({ showGcode: e.target.checked })),
        setShowLaser: e => dispatch(setWorkspaceAttrs({ showLaser: e.target.checked })),
        setShowDocuments: e => dispatch(setWorkspaceAttrs({ showDocuments: e.target.checked })),
    })
)(Workspace);
export default Workspace;
