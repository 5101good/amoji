/** Runs on the host's surface. Only a click token crosses back, never a model prompt. */
export default function Picture(props, surface) {
  const {Box,Text,Svg}=surface.elements;
  if(surface.state===undefined) surface.setState({down:false});
  surface.onPointer(e=>{
    if(e.type==='down'&&e.button==='left') surface.setState({down:true});
    if(e.type==='up') {
      const pressed=surface.state?.down;surface.setState({down:false});
      if(pressed&&e.button==='left'&&e.x>=0&&e.y>=0&&e.x<surface.columns&&e.y<surface.rows) surface.post({action:'send'});
    }
  });
  return Box({width:14,height:6,alignItems:'center',children:[Svg?Svg({source:props.preview,alt:props.alt,width:96,height:96}):Text({children:[props.alt]})]});
}
