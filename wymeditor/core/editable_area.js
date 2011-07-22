Wymeditor.EditableArea = function EditableArea (element) {
    Wymeditor.Observable.call(this);
    this.element = $(element);
    
    this.dom = Wymeditor.dom;
    this.normalizer = this.dom.normalizer;
    this.serializer = this.dom.serializer;
    this.structureManager = this.dom.structureManager();
    this.selection = Wymeditor.selection;
    this.utils = Wymeditor.utils;
    
    this.init();
}
Wymeditor.EditableArea.prototype = Wymeditor.utils.extendPrototypeOf(Wymeditor.Observable, {
    init: function () {
        this.fireEvent('init');
        this.enable();
        this.fireEvent('postInit');
    },
    
    enable: function () {
        this.element.attr('contentEditable', true)
                    .addClass('wym-editable');
        
        this.element.bind('keydown.wym', this.utils.setScope(this, this.onKeyDown));
        this.fireEvent('enable');
    },
    disable: function () {
        this.element.attr('contentEditable',false)
                    .removeClass('wym-editable');
        this.element.unbind('.wym');
        this.fireEvent('disable');
    },
    
    onKeyDown: function (element, event) {
        if (this.isEmpty()) {
            this.selection.selectNodeContents(this.appendBlock());
        }
        
        this.handleEnterKey(element, event);
    },
    
    handleEnterKey: function (element, event) {
        var ranges, 
            range;
        if (event.keyCode === 13) {
            event.preventDefault();
            
            ranges = this.selection.getRanges(this.element);

            if (ranges.length) {
                range = ranges[0];
                range.deleteContents();
                
                if (event.shiftKey) {
                    range.insertNode($('<br />')[0]);
                } else {
                    this.selection.selectNodeContents(this.splitBlock(range.startContainer, range.startOffset));
                }

                this.selection.detach(ranges);
            }
        }
    },
    
    splitTextNode: function (textNode, offset) {
        if (offset > 0 && offset < textNode.length) {
            textNode.splitText(offset);
            return textNode.nextSibling;
        } else if (offset <= 0) {
            return $(document.createTextNode('')).insertBefore(textNode)[0];
        } else {
            return $(document.createTextNode('')).insertAfter(textNode)[0];
        }
    },
    
    splitNodes: function (node, offset, container) {
        var child = node.nodeType === Wymeditor.TEXT_NODE ?
                this.splitTextNode(node, offset) : node,
            oldParent = child.parentNode,
            newParent = document.createElement(oldParent.tagName),
            parents = [],
            children = [],
            i;
        
        container = $(container || oldParent.parentNode)[0];
        
        // We're splitting the parentNode
        if (child.parentNode !== container) {
            do {
                children.push(child);
                child = child.nextSibling;
            } while (child);
            
            for (i = 0; child = children[i]; i++) {
                newParent.appendChild(oldParent.removeChild(child));
            }
            
            oldParent.normalize();
            newParent.normalize();
            
            $(newParent).insertAfter(oldParent);
            this.populateEmptyElements([oldParent, newParent]);
            
            if (newParent.parentNode !== container) {
                this.splitNodes(newParent, null, container);
            }            
            
            return newParent;
        }
        return container.children[container.children.length - 1];
    },

    splitRangeAtBlockBoundaries: function (range) {
        var filter = this.structureManager.getCollectionSelector('block'),
            nodes = range.getNodes([Wymeditor.ELEMENT_NODE], function (n) { 
                return $(n).is(filter); }),
            node,
            ranges = [],
            newRange,
            i;
        
        for (i = 0; node = nodes[i]; i++) {
            newRange = range.cloneRange();

            switch (range.compareNode(node)) {
                // node starts before the range
                case range.NODE_BEFORE:
                    newRange.setEnd(node, node.childNodes.length);
                    ranges.push(newRange);
                break; 
                // node ends after the range
                case range.NODE_AFTER:
                    newRange.setStart(node, 0);
                    ranges.push(newRange);
                break; 
                // node is completely contained within the range
                case range.NODE_INSIDE:
                    newRange.selectNodeContents(node);
                    ranges.push(newRange);
                break;
                default:
                    ranges.push(newRange);
                break;
            }
        }

        if (ranges.length) {
            return ranges;
        } else {
            return [range];
        }
    },

    splitRangesAtBlockBoundaries: function (ranges) {
        var newRanges = [], range, i;
        for (i = 0; range = ranges[i]; i++) {
            newRanges = newRanges.concat(this.splitRangeAtBlockBoundaries(range));
        }
        return newRanges;
    },

    splitNodesAtRangeBoundaries: function (ranges) {
        var range, container, i, startNode, startOffset, endNode, endOffset;


        // Respect block elements
        ranges = this.splitRangesAtBlockBoundaries(ranges);
        
        for (i = 0; range = ranges[i]; i++) {
            container = this.findParentBlockNode(range.startContainer);

            // Save all the positions, because Firefox goes crazy once you modify the DOM. 
            // Also, manage ranges that start or end between nodes.
            if (range.startContainer.nodeType === Wymeditor.TEXT_NODE) {
                startNode = range.startContainer;
                startOffset = range.startOffset;
            } else {
                // Split before starting node
                startNode = range.startContainer.childNodes[range.startOffset - 1];
                startOffset = 0;
            }
            if (range.endContainer.nodeType === Wymeditor.TEXT_NODE) {
                endNode = range.endContainer;
                endOffset = range.endOffset;
            } else {
                // Split after end node 
                endNode = range.endContainer.childNodes[range.endOffset];
                endOffset = 0;
            }

            this.splitNodes(startNode, startOffset, container);
            if (!range.collapsed) {
                this.splitNodes(endNode, endOffset, container);
            }
        }
        return ranges;
    },

    splitBlock: function (node, offset) {
        return this.splitNodes(node, offset, this.findParentBlockNode(node).parent()[0]);
    },
    
    appendBlock: function (type, element) {
        var newBlock;
        
        type = type || 'p';
        
        // Should find the nearest parent that allows block elements
        element = this.element;
        
        // Elements needs content to be selectable in IE and Webkit, now we only
        // need to clean this up...
        newBlock = $('<'+type+' />').appendTo(element);
        this.populateEmptyElements(newBlock);
        
        return newBlock[0];
    },
    
    formatBlock: function (target, tagName) {
        var node,
            block,
            newBlock;
        
        if (target && (target.nodeName || (target[0] && target[0].nodeName))) {
            node = $(target);
        } else if (this.utils.is('String', target)) {
            tagName = target;
            node = $(this.selection.getCommonAncestors(this.element)[0]);
        }
        
        if (node.length) {
            this.selection.save();

            block = this.findParentBlockNode(node);
            
            if (block.length) {
                newBlock = $('<'+tagName+'/>').append(block.clone().get(0).childNodes);
                block.replaceWith(newBlock);
            }

            this.selection.restore();
        }
    },
    
    formatSelection: function (element) {
        var ranges = this.splitRangesAtBlockBoundaries(
                this.selection.getRanges(this.element)
            ), i, range, wrapper;

        if (this.utils.is('String', element)) {
            // Assume we have a tag name
            element = $('<'+element+'/>');
        } else {
            // Let jQuery deal with it
            element = $(element).first();
        }

        for (i = 0; range = ranges[i]; i++) {
            wrapper = element.clone()[0];
            wrapper.appendChild(range.extractContents());
            range.insertNode(wrapper);
            range.selectNodeContents(wrapper);
        }

        this.selection.selectRanges(ranges);
    },
    
    unformatSelection: function (filter) {
        var i, ranges, range, nodes, func, normalize = [];

        this.selection.save();

        this.splitNodesAtRangeBoundaries(
            this.selection.getRanges(this.element));
        
        this.selection.restore();

        ranges = this.selection.getRanges(this.element);

        this.selection.save();

        for (i = 0; range = ranges[i]; i++) {
            // element is child
            nodes = range.getNodes([1], function (node) {
                return $(node).is(filter);
            });

            // element is container
            nodes = nodes.concat($(range.commonAncestorContainer).filter(filter).toArray());

            // element is parent
            nodes = nodes.concat(this.findParentNode(range.commonAncestorContainer, filter).toArray());

            // Remove any duplicates
            nodes = $.unique(nodes); 

            $(nodes).each(function() {
                $(this.childNodes).unwrap();
            });
            //range.detach();
            
            // Remember which nodes to normalize
            normalize.push(this.findParentBlockNode(range.commonAncestorContainer));
        }

        this.selection.restore();

        this.normalizer.normalizeNodes(normalize);

    },
    
    toggleSelectionFormat: function (element) {
        var ranges = this.selection.getRanges(this.element);
        
        this.selection.detach(ranges);      
    },
    
    findParentNode: function (node, filter, container) {
        node = $(node);
        container = container || this.element;
        
        if (container.length) {
            while (node.length &&!node.is(filter) && !node.is(container)) {
                node = node.parent();
            }
            if (!node.is(container)) {
                return node;
            }
        }
        return $();
    },
    
    findParentBlockNode: function (node, container) {
        return this.findParentNode(node,
            this.structureManager.getCollectionSelector('block'), container);
    },
    
    populateEmptyElements: function (elements) {
        elements = elements || this.element;
        $(elements).each(function(){
            $(this).children().andSelf()
                .filter(':empty:not(br)').append('<br _wym_placeholder="true" />');
        });
    },


    
    html: function (html) {
        if (this.utils.is('String', html)) {
            this.element.html(html);
            return undefined;
        } else {
            html = this.serializer.toHtml(this.element[0]);
            // this.plugin.htmlFormatter.format(html)
            return html;
        }
    },
    
    isEmpty: function () {
        return this.element.html() === '';
    }
});